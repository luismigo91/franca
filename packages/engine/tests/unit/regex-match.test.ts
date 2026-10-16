import { describe, expect, it } from 'vitest';
import { expectProgramBound, native, oracleIsUnreliable, prng } from '../helpers/regex.js';
import { MAX_PATTERN_SIZE } from '../../src/constants.js';
import { compilePattern, patternSize } from '../../src/regex/compile.js';
import { matchPattern, type MatchStats } from '../../src/regex/match.js';
import { parseAssumingValid, parsePattern, PatternError } from '../../src/regex/parse.js';

// Alfabeto pequeño compartido por el generador de patrones y el de textos.
const ALPHABET = ['a', 'b', 'é', '😀', '1', ' '];
const ATOMS = ['a', 'a', 'b', 'b', 'é', '😀', '1', ' ', '.', '[ab]', '[^a]', '\\w', '\\d', '\\s', '\\p{L}', '\\W', '[a-é]'];
const ASSERTIONS = ['^', '$', '\\b', '\\B'];
const QUANTIFIERS = ['*', '+', '?', '{2}', '{1,2}', '{0,2}', '{2,}'];

function generator(seed: number) {
  const rand = prng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  let names = 0;

  function quantifier(): string {
    if (rand() > 0.4) return '';
    return pick(QUANTIFIERS) + (rand() < 0.25 ? '?' : '');
  }

  function term(depth: number): string {
    const r = rand();
    if (r < 0.12) return pick(ASSERTIONS);
    if (r < 0.35 && depth > 0) {
      const open = pick(['(', '(?:', `(?<n${names++}>`]);
      return `${open}${alternation(depth - 1)})${quantifier()}`;
    }
    return pick(ATOMS) + quantifier();
  }

  function sequence(depth: number): string {
    const count = Math.floor(rand() * 4);
    return Array.from({ length: count }, () => term(depth)).join('');
  }

  function alternation(depth: number): string {
    const count = 1 + (rand() < 0.3 ? Math.floor(rand() * 2) + 1 : 0);
    return Array.from({ length: count }, () => sequence(depth)).join('|');
  }

  return {
    rand,
    pick,
    pattern(): string {
      names = 0;
      return alternation(2);
    },
    text(): string {
      const length = Math.floor(rand() * 9);
      return Array.from({ length }, () => pick(ALPHABET)).join('');
    },
  };
}

describe('diferencial contra RegExp nativo', () => {
  it('coincide en ≥ 5000 casos generados y no es vacuo', () => {
    const gen = generator(20261016);
    let cases = 0;
    let truths = 0;
    while (cases < 6000) {
      const pattern = gen.pattern();
      expectProgramBound(pattern);
      for (let i = 0; i < 3; i++) {
        const text = gen.text();
        if (oracleIsUnreliable(pattern, text)) continue;
        const expected = native(pattern, text);
        expect(matchPattern(pattern, text), `/${pattern}/u contra ${JSON.stringify(text)}`).toBe(expected);
        cases++;
        if (expected) truths++;
      }
    }
    expect(truths / cases).toBeGreaterThanOrEqual(0.2);
    expect(1 - truths / cases).toBeGreaterThanOrEqual(0.2);
  });

  it('coincide también en textos hasta 12 caracteres', () => {
    const gen = generator(7);
    for (let i = 0; i < 1500; i++) {
      const pattern = gen.pattern();
      const text = Array.from({ length: 12 }, () => gen.pick(ALPHABET)).join('');
      if (oracleIsUnreliable(pattern, text)) continue;
      expect(matchPattern(pattern, text), `/${pattern}/u contra ${JSON.stringify(text)}`).toBe(native(pattern, text));
    }
  });
});

describe('corpus curado', () => {
  const emojiLetterWord: [string, string][] = [
    ['^.$', '😀'],
    ['^..$', '😀'],
    ['^.$', '\ud83d'],
    ['^.$', '\n'],
    ['^\\uD83D\\uDE00$', '😀'],
    ['^\\u{1F600}$', '😀'],
    ['^[😀]$', '😀'],
    ['^[^a]$', '😀'],
    ['😀+', 'x😀😀y'],
    ['^\\p{L}+$', 'Ana'],
    ['^\\p{L}+$', 'Añá'],
    ['^\\p{L}+$', 'An4'],
    ['\\P{L}', 'abc'],
    ['\\p{Script=Greek}', 'αβγ'],
    ['\\bAna\\b', 'hola Ana!'],
    ['\\bAna\\b', 'Anabel'],
    ['\\Bna\\B', 'Anabel'],
    ['\\b', ''],
    ['\\B', ''],
    ['\\bé', 'é'],
    ['^b', 'a\nb'],
    ['a$', 'a\nb'],
    ['^$', ''],
    ['^$', 'a'],
    ['a+?b', 'aaab'],
    ['a*?$', 'aaa'],
    ['(a+)+$', 'aaaa!'],
    ['(a(b(c)))+d', 'abcabcd'],
    ['(?<year>\\d{4})-(?<month>\\d{2})', 'el 2026-10-16'],
    ['^(?<prov>\\d{2})\\d+?$', '28001'],
    ['(?:\\b)*', ''],
    ['(?:\\b)*x', 'x'],
    ['(?:\\b)*$', 'a b'],
    ['(a|)*b', 'aab'],
    ['(a|)*b', 'c'],
    ['(?:^|a)+', 'bab'],
    ['^(?:^|a)+b$', 'aab'],
    ['(?:$)*', 'abc'],
    ['(?:$)*a', 'abc'],
    ['(a*)*b', 'aaab'],
    ['(a*)+$', 'b'],
    ['(a|b)*c', 'ababc'],
    ['(|a)+', 'a'],
    ['^(?:)$', ''],
    ['a{2}', 'a'],
    ['a{2}', 'aa'],
    ['^a{2,3}$', 'aaaa'],
    ['^a{0}$', ''],
    ['^a{0,1}b?$', 'ab'],
    ['x*', ''],
    ['[\\d\\s]+', 'ab 3'],
    ['\\.', 'a.b'],
    ['\\x41\\cJ', 'A\n'],
    ['\\0', '\0'],
    ['[\\b]', '\b'],
    ['a|b|', 'zzz'],
    ['^\\s*$', ' \t\n'],
    ['é', 'e\u0301'],
    ['^\\d{5}$', '28001'],
    ['^\\d{5}$', '2800'],
  ];

  it.each(emojiLetterWord)('/%s/u contra %j', (pattern, text) => {
    expect(matchPattern(pattern, text)).toBe(native(pattern, text));
  });

  it('resultados concretos', () => {
    expect(matchPattern('^.$', '😀')).toBe(true);
    expect(matchPattern('^(a+)+$', 'a'.repeat(30) + '!')).toBe(false);
    expect(matchPattern('(?:\\b)*', '')).toBe(true);
    expect(matchPattern('(a|)*b', 'c')).toBe(false);
    expect(matchPattern('^\\p{L}+$', 'Ana')).toBe(true);
  });

  it('\\B no se prueba dentro de un par sustituto (la spec; V8 lo prueba)', () => {
    expect(matchPattern('\\B', 'a😀b')).toBe(false);
    expect(matchPattern('\\B', '😀')).toBe(true);
    expect(matchPattern('a\\B😀\\Bb', 'a😀b')).toBe(false);
  });
});

describe('fuera del subconjunto', () => {
  const rejects = (build: (g: ReturnType<typeof generator>) => string, assumeValid: boolean): void => {
    const gen = generator(99);
    for (let i = 0; i < 300; i++) {
      const pattern = build(gen);
      const parse = assumeValid ? parseAssumingValid : parsePattern;
      let error: unknown;
      try {
        parse(pattern);
      } catch (e) {
        error = e;
      }
      expect(error, `/${pattern}/ debería rechazarse`).toBeInstanceOf(PatternError);
      expect(() => matchPattern(pattern, 'aa')).toThrow(PatternError);
    }
  };
  const inner = (g: ReturnType<typeof generator>) => g.pick(['a', 'b', '[ab]', 'a+', '\\w', '(?:a|b)']);

  it('referencias hacia atrás', () => {
    rejects((g) => `(${inner(g)})${g.pick(['', 'b'])}\\1`, false);
    rejects((g) => `(?<x>${inner(g)})\\k<x>`, false);
  });

  it('lookahead y lookbehind', () => {
    rejects((g) => `${inner(g)}(?=${inner(g)})`, false);
    rejects((g) => `${inner(g)}(?!${inner(g)})`, false);
    rejects((g) => `(?<=${inner(g)})${inner(g)}`, false);
    rejects((g) => `(?<!${inner(g)})${inner(g)}`, false);
  });

  it('modificadores en línea y nombres repetidos, aunque el V8 del host ya los rechace', () => {
    rejects((g) => `(?i:${inner(g)})`, true);
    rejects((g) => `(?-i:${inner(g)})`, true);
    rejects((g) => `(?<x>${inner(g)})|(?<x>${inner(g)})`, true);
    rejects((g) => `(?<a>${inner(g)})(?<\\u0061>${inner(g)})`, true);
    rejects((g) => `(?<a>${inner(g)})(?<\\u{61}>${inner(g)})`, true);
  });
});

describe('si el parser acepta, el nativo compila', () => {
  it('sobre patrones generados y mutados', () => {
    const gen = generator(31337);
    const syntax = ['(', ')', '[', ']', '{', '}', '|', '*', '+', '?', '\\', '^', '$', '.', '(?', '(?<', '\\1', '{2,1}'];
    let accepted = 0;
    for (let i = 0; i < 4000; i++) {
      let pattern = gen.pattern();
      if (i % 2 === 1) {
        const at = Math.floor(gen.rand() * (pattern.length + 1));
        const piece = gen.pick(syntax);
        pattern = gen.rand() < 0.5 ? pattern.slice(0, at) + piece + pattern.slice(at) : pattern.slice(0, at) + pattern.slice(at + 1);
      }
      let ast;
      try {
        ast = parsePattern(pattern);
      } catch (error) {
        expect(error, `/${pattern}/`).toBeInstanceOf(PatternError);
        continue;
      }
      accepted++;
      if (patternSize(ast) <= MAX_PATTERN_SIZE) expectProgramBound(pattern);
      expect(() => new RegExp(pattern, 'u'), `/${pattern}/u`).not.toThrow();
      const text = gen.text();
      if (oracleIsUnreliable(pattern, text)) continue;
      expect(matchPattern(pattern, text), `/${pattern}/u contra ${JSON.stringify(text)}`).toBe(native(pattern, text));
    }
    expect(accepted).toBeGreaterThan(2000);
  });
});

describe('cota de trabajo', () => {
  const stats = (): MatchStats => ({ work: 0, instructions: 0 });
  const cases: [string, string][] = [
    ['^(a+)+$', 'a'.repeat(5000) + '!'],
    ['(a|aa)*!$', 'a'.repeat(5000) + '!'],
    ['(?:a*)*b', 'a'.repeat(3000)],
    ['\\d*\\d*\\d*\\d*x', '1'.repeat(2000)],
    ['(?:a?){300}a{300}', 'a'.repeat(300)],
    ['^(\\w+\\s?)*$', 'palabra '.repeat(200) + '!'],
    ['(x+x+)+y', 'x'.repeat(2000)],
    ['(?:(?:a|b)*c?)*d', 'ab'.repeat(1000)],
  ];

  it.each(cases)('/%s/ hace como mucho (n+1)·m pasos', (pattern, text) => {
    const s = stats();
    matchPattern(pattern, text, s);
    const n = Array.from(text).length;
    expect(s.instructions).toBeGreaterThan(0);
    expect(s.instructions).toBeLessThanOrEqual(2 * MAX_PATTERN_SIZE + 1);
    expect(s.work).toBeLessThanOrEqual((n + 1) * s.instructions);
  });

  it('el tiempo es lineal en el texto para el retroceso catastrófico', () => {
    expect(matchPattern('^(a+)+$', 'a'.repeat(5000) + '!')).toBe(false);
    expect(matchPattern('(a|aa)*!$', 'a'.repeat(5000) + '!')).toBe(true);
  });

  it('el trabajo crece linealmente con el texto', () => {
    const work = (n: number) => {
      const s = stats();
      matchPattern('^(a+)+$', 'a'.repeat(n) + '!', s);
      return s.work;
    };
    expect(work(2000) / work(1000)).toBeLessThan(2.2);
  });

  it('compila una sola vez cada átomo distinto', () => {
    expect(compilePattern('a{500}b').atoms).toEqual(['a', 'b']);
  });
});
