import { describe, expect, it } from 'vitest';
import { MAX_PATTERN_SIZE } from '../../src/constants.js';
import { expectProgramBound, native, oracleIsUnreliable, prng } from '../helpers/regex.js';
import { compilePattern, compileProgram, patternSize } from '../../src/regex/compile.js';
import { matchPattern, type MatchStats } from '../../src/regex/match.js';
import { parsePattern, PatternError } from '../../src/regex/parse.js';

function kindOf(pattern: string): string | undefined {
  try {
    compilePattern(pattern);
    return undefined;
  } catch (error) {
    if (error instanceof PatternError) return error.kind;
    throw error;
  }
}

describe('diferencial ampliado contra RegExp nativo (corpus fijo)', () => {
  const PATTERNS = [
    '^.$', '^.+$', 'a.b', 'a$', '^a', '\\u{1F600}', '\\ud83d\\ude00', '\\ud83d', '^\\ud83d$', '\\ude00',
    '[\\ud83d\\ude00]', '[\\u{1F600}-\\u{1F64F}]', '^[^]$', '^[]$', '[^]', '\\0', '\\x41', '\\cA', '\\n', '\\r', '\\t',
    '\\v', '\\f', '[\\b]', '[a\\-z]', '[\\w-]', '\\/', '\\p{Script=Greek}', '\\p{Lu}', '\\P{L}', '\\p{Emoji}',
    '\\p{ASCII}', '^\\p{L}+$', '\\p{Any}', '^\\p{Any}$', '\\p{sc=Latn}', '\\p{Script_Extensions=Latn}',
    '[\\p{L}\\p{N}]+', '\\s', '\\S', '\\W', '\\D', '[\\s\\S]', '^[^a]$', '(?<ñ>a)', '(?<\\u0061b>a)',
    '(?<a>x)|(?<b>y)', '(a)|(b)', '(?:a|)b', '^(?:a|b|)$', '()', '(|a)+', '^(a*)*$', '^(a*)+$', '^(a?){3}$',
    '^(a|b)*?c$', 'a{0}', '^a{0}$', '(?:a{0}){5}', 'a{2,2}', '^a{2,}$', '^a{0,}$', 'x*', '^$', '$^', '^^', '$$',
    '\\b\\b', '\\B\\B', '^\\b$', '^\\B$', '\\b', '\\B', '\\bé', 'é\\b', '(?:^|a)b', 'b(?:$|a)', '(^a|b$)', 'a|^',
    '^|a', '(?:\\b|a)+', '\\u{10FFFF}', '\\u{0}', '[\\u{0}-\\u{10FFFF}]', '^[\\u0000-\\uffff]$', '^[\\ud800-\\udfff]$',
    '[\\ud800-\\udbff]', '^.{2}$', '^..$', 'a_b', 'a\\b_', 'a\\B_', '\\b_', '_\\b', '^\\w+$', '^\\W+$', '[^\\w]',
  ];
  const TEXTS = [
    '', 'a', 'ab', '😀', 'a😀b', '\ud83d', '\ude00', '\ude00\ud83d', 'a\nb', 'a\n', '\n', '\r\n', '\u2028', '\u2029',
    'é', 'e\u0301', 'ΑΒΓ', 'Ab', 'A', ' ', '\t', '\u00a0', '\ufeff', 'aaa', 'aab', 'abc', 'x\u0000y', '\u{10FFFF}',
    'ñ', '1', '٣', '_', '-', 'bé', 'éb', 'a b', '😀😀', '\ud83d\ud83d', 'a\ud83d', '\ude00a', '\u0000', '￿',
    '\u180e', '\u2003', 'a_b', '_a', 'a_',
  ];

  it('coincide en patrones × textos con surrogates sueltos, terminadores de línea y escapes', () => {
    let cases = 0;
    for (const pattern of PATTERNS) {
      for (const text of TEXTS) {
        if (oracleIsUnreliable(pattern, text)) continue;
        expect(matchPattern(pattern, text), `/${pattern}/u contra ${JSON.stringify(text)}`).toBe(native(pattern, text));
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(4000);
  });

  it('el guion bajo es carácter de palabra para \\b y \\B (como en el nativo)', () => {
    expect(matchPattern('a\\B_', 'a_')).toBe(true);
    expect(matchPattern('a\\b_', 'a_')).toBe(false);
    expect(matchPattern('^\\b_', '_')).toBe(true);
    expect(matchPattern('_\\b$', 'x_')).toBe(true);
    expect(matchPattern('é\\b', 'é')).toBe(false); // é no es carácter de palabra: no hay frontera
  });
});

describe('diferencial ampliado contra RegExp nativo (generador con surrogates y saltos de línea)', () => {
  const rand = prng(20261017);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const ALPHABET = ['a', 'b', '\n', '\r', '\u2028', '😀', '\ud83d', '\ude00', 'é', '_', '1', ' ', '\u0000', 'Ω', '-'];
  const ATOMS = [
    'a', 'b', '.', '[^a]', '[a-b]', '[^\\n]', '\\w', '\\W', '\\d', '\\s', '\\S', '\\n', '\\p{L}', '\\P{L}', '\\ude00',
    '\\ud83d', '\\ud83d\\ude00', '\\u{1F600}', '[\\ud83d\\ude00]', '[^\\ud83d]', '[\\s\\S]', '\\u2028', 'é', '😀',
    '[\\w-]', '\\x61', '\\cJ', '\\0', '\\-', '\\.', '[.]',
  ];
  const ASSERTIONS = ['^', '$', '\\b', '\\B'];
  const QUANTIFIERS = ['*', '+', '?', '{0}', '{1}', '{2}', '{1,3}', '{0,1}', '{2,}', '{0,}', '{1,}'];
  const quantifier = (): string => (rand() < 0.4 ? pick(QUANTIFIERS) + (rand() < 0.3 ? '?' : '') : '');
  function term(depth: number): string {
    const r = rand();
    if (r < 0.15) return pick(ASSERTIONS);
    if (r < 0.4 && depth > 0) return `${pick(['(', '(?:'])}${alternation(depth - 1)})${quantifier()}`;
    return pick(ATOMS) + quantifier();
  }
  const sequence = (depth: number): string =>
    Array.from({ length: Math.floor(rand() * 5) }, () => term(depth)).join('');
  const alternation = (depth: number): string =>
    Array.from({ length: 1 + (rand() < 0.3 ? 1 : 0) + (rand() < 0.1 ? 1 : 0) }, () => sequence(depth)).join('|');

  it('coincide en 20000 casos válidos y no es vacuo', () => {
    let cases = 0;
    let truths = 0;
    while (cases < 20000) {
      const pattern = alternation(3);
      try {
        new RegExp(pattern, 'u');
      } catch {
        continue;
      }
      expectProgramBound(pattern);
      const text = Array.from({ length: Math.floor(rand() * 9) }, () => pick(ALPHABET)).join('');
      if (oracleIsUnreliable(pattern, text)) continue;
      const expected = native(pattern, text);
      expect(matchPattern(pattern, text), `/${pattern}/u contra ${JSON.stringify(text)}`).toBe(expected);
      cases++;
      if (expected) truths++;
    }
    expect(truths / cases).toBeGreaterThan(0.2);
    expect(1 - truths / cases).toBeGreaterThan(0.2);
  }, 15_000);
});

describe('Tamaño máximo del patrón: fronteras exactas', () => {
  it.each([
    ['a{1000}', 'a', false],
    ['a{0,500}', 'a', false],
    ['a{999,}', 'a', false],
    ['(?:a{25}){40}', 'a', false],
    ['(?:a{40}){25}', 'a', false],
    ['(?:a{0,19}){0,25}', 'a', false],
    ['(?:a|b){333}', 'a', false],
    ['(?:a*){500}', 'a', false],
    ['(?:\\b){1000}', 'a', false],
    ['(?:^){1000}', 'a', false],
    ['a{999}b', 'a', false],
    ['(?:a{2000}){0}', 'a', false],
    ['(?:a{0}){4000}', 'a', false],
    ['(?:){99999999999999999999}', 'a', false],
  ])('%s se acepta (tamaño ≤ 1000)', (pattern, text) => {
    expect(kindOf(pattern)).toBeUndefined();
    expect(() => matchPattern(pattern, text)).not.toThrow();
  });

  it.each([
    'a{1001}',
    'a{0,1001}',
    'a{1001,}',
    'a{1000}b',
    '(?:a{0,19}){0,26}',
    '(?:a{41}){25}',
    '(?:a|b){334}',
    '(?:a*){501}',
    '(?:\\b){1001}',
    '(?:^){1001}',
    'a{99999999999999999999}',
    'a{0,99999999999999999999}',
    `a{${'9'.repeat(400)}}`,
    '(?:(?:a{10}){10}){11}',
    '(?:a{500}){2}b',
  ])('%s se rechaza por tamaño', (pattern) => {
    expect(kindOf(pattern)).toBe('too_large');
  });

  it('un contador de 309 o más cifras no se confunde con «sin tope»', () => {
    const huge = '9'.repeat(400);
    expect(kindOf(`a{1,${huge}}`)).toBe('too_large');
    expect(kindOf(`a{${huge},}`)).toBe('too_large');
    expect(kindOf(`a{${'9'.repeat(309)}}`)).toBe('too_large');
    expect(matchPattern(`^(?:){${huge}}$`, '')).toBe(true);
    expect(matchPattern(`^(?:){1,${huge}}$`, '')).toBe(true);
  });

  it('MAX_PATTERN_SIZE vale 1000 y las alternativas vacías se evalúan bien', () => {
    expect(MAX_PATTERN_SIZE).toBe(1000);
    expect(matchPattern('', 'x')).toBe(true);
    expect(matchPattern('|', '')).toBe(true);
    expect(matchPattern('||||', 'x')).toBe(true);
    expect(matchPattern('^(?:a|b|)$', '')).toBe(true);
    expect(matchPattern('^(a|)+$', 'aaa')).toBe(true);
    expect(matchPattern('^(?:|a)+$', 'aa')).toBe(true);
    expect(matchPattern('^(?:)*a$', 'a')).toBe(true);
  });

  it('el tamaño de una alternativa cuenta cada rama y su separador, también dentro de una repetición', () => {
    expect(kindOf(`(?:${'a|'.repeat(249)}a){2}`)).toBeUndefined(); // (250 + 249) × 2 = 998
    expect(kindOf(`(?:${'a|'.repeat(250)}a){2}`)).toBe('too_large'); // (251 + 250) × 2 = 1002
  });
});

describe('[critical] el tamaño acota las instrucciones emitidas', () => {
  const stacked = (() => {
    let inner = 'a';
    for (let i = 0; i < 98; i++) inner = `(?:${inner})*`;
    return `(?:${inner}){999}b`;
  })();

  it.each([
    '(?:(?:|){1000}){1000}',
    '(?:(?:|){1000}){1000}a',
    '(?:(?:(?:|){1000}){1000}){1000}a',
    stacked,
    '(?:(?:a*)*){500}b',
    `(?:${'|'.repeat(1500)})a`,
  ])('%s se rechaza como demasiado grande, rápido y sin construir el programa', (pattern) => {
    const started = performance.now();
    expect(kindOf(pattern)).toBe('too_large');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('la propiedad instrucciones ≤ 2·tamaño + 1 y tamaño 0 ⇔ no emite nada, sobre un corpus', () => {
    for (const pattern of ['', '|', '(?:|)*', '(?:a{0}){9}', '(?:|){7}a', '(?:a|b|){3}', 'a{2,5}', '(?:a*)+b?', '^$', '(?:\\b|){10}', 'a{0}']) {
      const ast = parsePattern(pattern);
      const size = patternSize(ast);
      const { instructions } = compileProgram(ast);
      expect(instructions.length, pattern).toBeLessThanOrEqual(2 * size + 1);
      expect(size === 0, pattern).toBe(instructions.length === 1); // solo `match`
    }
  });
});

describe('Anidamiento extremo del patrón', () => {
  it.each([5000, 20000])('%i grupos anidados se rechazan siempre como PatternError', (depth) => {
    for (const [open, close] of [['(', ')'], ['(?:', ')'], ['(?:', ')*']] as const) {
      expect(() => matchPattern(open.repeat(depth) + 'a' + close.repeat(depth), 'a')).toThrow(PatternError);
    }
  });

  it('100000 grupos anidados se rechazan siempre como PatternError', () => {
    for (const [open, close] of [['(', ')'], ['(?:', ')'], ['(?:', ')*']] as const) {
      const pattern = open.repeat(100000) + 'a' + close.repeat(100000);
      expect(() => matchPattern(pattern, 'a')).toThrow(PatternError);
    }
  });

  it('100 grupos anidados son válidos y 101 se rechazan con un resultado fijo', () => {
    expect(matchPattern('('.repeat(100) + 'a' + ')'.repeat(100), 'a')).toBe(true);
    expect(() => matchPattern('('.repeat(101) + 'a' + ')'.repeat(101), 'a')).toThrow(PatternError);
  });
});

describe('Cota de trabajo lineal en el tamaño máximo del patrón y del texto', () => {
  const N = 16384;
  const stats = (pattern: string, text: string): MatchStats => {
    const s: MatchStats = { work: 0, instructions: 0 };
    matchPattern(pattern, text, s);
    return s;
  };

  it.each([
    ['(?:a*){250}(?:a*){249}b', 'a'.repeat(N)],
    ['(?:a|a){300}b', 'a'.repeat(N)],
    ['^(?:a|aa|aaa)*!$', 'a'.repeat(N)],
    ['(?:(?:a*)*)*b', 'a'.repeat(N)],
    ['(?:\\w+\\s?)*$!', 'ab '.repeat(N / 3)],
    ['(?:a?){300}a{300}', 'a'.repeat(N)],
    ['(.*)(.*)(.*)(.*)(.*)x', 'y'.repeat(N)],
    ['(?:😀|a)*b', '😀a'.repeat(N / 4)],
  ])('%s: hace como mucho (n + 1) · m visitas sobre un texto largo', (pattern, text) => {
    const s = stats(pattern, text);
    const n = Array.from(text).length;
    expect(s.instructions).toBeLessThanOrEqual(2 * MAX_PATTERN_SIZE + 1);
    expect(s.work).toBeLessThanOrEqual((n + 1) * s.instructions);
    expect(s.work).toBeGreaterThan(n); // no es vacuo: recorrió el texto
  });

  it('el resultado del retroceso catastrófico no depende del tamaño del texto', () => {
    for (const n of [10, 100, 1000, 16384]) {
      expect(matchPattern('^(a+)+$', 'a'.repeat(n) + '!')).toBe(false);
      expect(matchPattern('^(a+)+$', 'a'.repeat(n))).toBe(true);
      expect(matchPattern('^(a|aa)+$', 'a'.repeat(n) + '!')).toBe(false);
      expect(matchPattern('(a|aa)*!$', 'a'.repeat(n) + '!')).toBe(true);
    }
  });
});
