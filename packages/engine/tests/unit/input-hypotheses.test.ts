import { describe, expect, it } from 'vitest';
import { MAX_INPUT_LENGTH } from '../../src/constants.js';
import { checkTextAnswer } from '../../src/input/answer.js';
import { PARSERS } from '../../src/input/parsers/index.js';
import { readUserInput } from '../../src/input/user-input.js';
import { prepareRules, type AnswerRules } from '../../src/input/validation.js';
import type { MatchStats } from '../../src/regex/match.js';
import { textOf } from '../../src/template.js';
import { choiceNode, inputNode } from '../helpers/input-node.js';
import { expectProgramBound } from '../helpers/regex.js';

const rules = (type: string, validation?: Record<string, unknown>): AnswerRules => {
  const result = prepareRules(inputNode(type, validation ? { validation } : {}));
  if (!result.ok) throw new Error(result.message);
  return result.rules;
};
const check = (raw: string, type: Parameters<typeof checkTextAnswer>[1], validation?: Record<string, unknown>) =>
  checkTextAnswer(raw, type, 'es', rules(type, validation));

describe('Hipótesis (a): too_long se mide antes de recortar o recorrer el texto', () => {
  it('4097 espacios → too_long, no required', () => {
    expect(check(' '.repeat(MAX_INPUT_LENGTH + 1), 'text')).toEqual({ ok: false, reason: 'too_long' });
  });

  it('"Ana" rodeado de espacios hasta 4097 unidades → too_long', () => {
    const padded = `${' '.repeat(2000)}Ana${' '.repeat(MAX_INPUT_LENGTH - 2002)}`;
    expect(padded).toHaveLength(MAX_INPUT_LENGTH + 1);
    expect(check(padded, 'text')).toEqual({ ok: false, reason: 'too_long' });
  });

  it('un millón de "a" con ^(a+)+$ → too_long sin llegar al matcher', () => {
    const stats: MatchStats = { work: -1, instructions: -1 };
    const result = checkTextAnswer('a'.repeat(1_000_000), 'text', 'es', rules('text', { pattern: '^(a+)+$' }), stats);
    expect(result).toEqual({ ok: false, reason: 'too_long' });
    expect(stats).toEqual({ work: -1, instructions: -1 }); // el matcher no corrió
  });

  it('un millón de espacios y de emoji también', () => {
    for (const unit of [' ', '😀', '\u0000']) {
      expect(check(unit.repeat(1_000_000), 'text')).toEqual({ ok: false, reason: 'too_long' });
    }
  });
});

describe('Hipótesis (b): la forma textual del valor convertido cabe en 4096 unidades', () => {
  it('url con href de 4094 aceptada y de 4100 rechazada', () => {
    const ok = check(`example.com/${'ñ'.repeat(679)}`, 'url');
    expect(ok.ok && (ok.value as string).length).toBe(4094);
    expect(check(`example.com/${'ñ'.repeat(680)}`, 'url')).toEqual({ ok: false, reason: 'invalid_format' });
  });

  it('url de 4096 unidades de 中 en la ruta rechazada', () => {
    expect(check(`example.com/${'中'.repeat(4084)}`, 'url')).toEqual({ ok: false, reason: 'invalid_format' });
    expect(check(`example.com/${'中'.repeat(100)}`, 'url').ok).toBe(true);
  });

  it('url con href justo en 4096 aceptada y en 4097 rechazada', () => {
    const base = 'https://example.com/'.length;
    const at = check(`example.com/${'a'.repeat(MAX_INPUT_LENGTH - base)}`, 'url');
    expect(at.ok && textOf(at.value).length).toBe(MAX_INPUT_LENGTH);
    expect(check(`example.com/${'a'.repeat(MAX_INPUT_LENGTH - base + 1)}`, 'url').ok).toBe(false);
  });

  it('text de 4096 unidades: textOf de 4096', () => {
    const result = check('a'.repeat(MAX_INPUT_LENGTH), 'text');
    expect(result.ok && textOf(result.value).length).toBe(MAX_INPUT_LENGTH);
  });

  it('number de 4096 cifras (0…01) → textOf "1"', () => {
    const result = check(`${'0'.repeat(MAX_INPUT_LENGTH - 1)}1`, 'number');
    expect(result.ok && textOf(result.value)).toBe('1');
  });

  it('ningún tipo guarda un valor mayor que 4096 aunque el texto sea el más largo posible', () => {
    const longest: [Parameters<typeof checkTextAnswer>[1], string][] = [
      ['text', 'a'.repeat(MAX_INPUT_LENGTH)],
      ['phone', `+1234567${' '.repeat(MAX_INPUT_LENGTH - 8)}`],
      ['number', `${'0'.repeat(4000)}12345,678`],
      ['email', `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.com`],
      ['date', '2026-10-16'],
      ['boolean', 'FALSE'],
    ];
    for (const [type, raw] of longest) {
      const result = check(raw, type);
      expect(result.ok, type).toBe(true); // se mide una respuesta aceptada, no un rechazo
      if (result.ok) expect(textOf(result.value).length, type).toBeLessThanOrEqual(MAX_INPUT_LENGTH);
    }
  });
});

describe('Hipótesis (c): el camino real de checkTextAnswer cuesta ≤ (4096+1)·m', () => {
  // `Q` no aparece en ningún texto aceptado: el patrón nunca casa antes de recorrerlo entero.
  const pattern = '(?:.?){300}.{300}Q';
  const longest: [Parameters<typeof checkTextAnswer>[1], string][] = [
    ['text', 'a'.repeat(MAX_INPUT_LENGTH)],
    ['url', `example.com/${'a'.repeat(MAX_INPUT_LENGTH - 'https://example.com/'.length)}`],
    ['email', `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.com`],
    ['phone', '+123456789012345'],
    ['number', `${'0'.repeat(4000)}12345,678`],
    ['date', '2026-10-16'],
    ['boolean', 'true'],
  ];

  it('el patrón de prueba tiene tamaño ≤ 1000 y programa ≤ 2001', () => {
    expectProgramBound(pattern);
  });

  it.each(longest)('%s', (type, raw) => {
    const stats: MatchStats = { work: 0, instructions: 0 };
    const result = checkTextAnswer(raw, type, 'es', rules(type, { pattern }), stats);
    expect(result).toEqual({ ok: false, reason: 'pattern_mismatch' });
    expect(stats.instructions).toBeGreaterThan(600); // el patrón se compiló y se ejecutó de verdad
    expect(stats.instructions).toBeLessThanOrEqual(2001);
    expect(stats.work).toBeLessThanOrEqual((MAX_INPUT_LENGTH + 1) * stats.instructions);
    expect(stats.work).toBeGreaterThan(stats.instructions); // recorrió texto
  });

  it('el texto más largo posible recorre ≥ 4000 code points', () => {
    const stats: MatchStats = { work: 0, instructions: 0 };
    checkTextAnswer('a'.repeat(MAX_INPUT_LENGTH), 'text', 'es', rules('text', { pattern }), stats);
    expect(stats.work).toBeGreaterThan(4000 * 300);
  });
});

describe('Hipótesis: leer la entrada cuesta O(opciones del nodo)', () => {
  /** Proxy sobre `target` que cuenta cada acceso (get, has, ownKeys, getOwnPropertyDescriptor). */
  function counting<T extends object>(target: T): { proxy: T; reads: string[] } {
    const reads: string[] = [];
    const proxy = new Proxy(target, {
      get(t, key, receiver) {
        reads.push(`get:${String(key)}`);
        return Reflect.get(t, key, receiver);
      },
      has(t, key) {
        reads.push(`has:${String(key)}`);
        return Reflect.has(t, key);
      },
      ownKeys(t) {
        reads.push('ownKeys');
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, key) {
        reads.push(`gopd:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
    });
    return { proxy, reads };
  }

  const multiple = choiceNode(['a', 'b'], { multiple: true });

  it('{choices: proxy} con length 2³²−1 → null con ≤ 1 lectura', () => {
    const reads: string[] = [];
    const lying = new Proxy([] as unknown[], {
      get(t, key, receiver) {
        reads.push(String(key));
        return key === 'length' ? 2 ** 32 - 1 : Reflect.get(t, key, receiver);
      },
    });
    expect(readUserInput(multiple, { choices: lying })).toBeNull();
    expect(reads.length).toBeLessThanOrEqual(1);
  });

  it('un array real de un millón de ids se rechaza sin recorrerlo', () => {
    let reads = 0;
    const big = new Proxy(new Array<unknown>(1_000_000).fill('a'), {
      get(t, key, receiver) {
        reads++;
        return Reflect.get(t, key, receiver);
      },
    });
    expect(readUserInput(multiple, { choices: big })).toBeNull();
    expect(reads).toBeLessThanOrEqual(1);
  });

  it('{text: proxy} → null sin ninguna lectura del proxy', () => {
    const { proxy, reads } = counting([1] as unknown[]);
    expect(readUserInput(inputNode('text'), { text: proxy })).toBeNull();
    expect(reads).toEqual([]);
  });

  it('un getter text se lee exactamente una vez', () => {
    let reads = 0;
    const input = {
      get text() {
        reads++;
        return reads === 1 ? 'Ana' : 5;
      },
    };
    expect(readUserInput(inputNode('text'), input)).toEqual({ kind: 'text', text: 'Ana' });
    expect(reads).toBe(1);
  });

  it('un getter choice y un getter choices se leen una vez', () => {
    let a = 0;
    readUserInput(choiceNode(['a']), { get choice() { a++; return 'a'; } });
    expect(a).toBe(1);
    let b = 0;
    readUserInput(multiple, { get choices() { b++; return ['a']; } });
    expect(b).toBe(1);
  });

  it('cada elemento de un array válido se lee una sola vez', () => {
    const reads: string[] = [];
    const ids = new Proxy(['a', 'b'], {
      get(t, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(key);
        return Reflect.get(t, key, receiver);
      },
    });
    expect(readUserInput(multiple, { choices: ids })).toEqual({ kind: 'choices', options: [0, 1] });
    expect(reads).toEqual(['0', '1']);
  });
});

describe('Los conversores no dependen del locale ni de Intl', () => {
  it('boolean con İ no cambia según el entorno', () => {
    expect(PARSERS.boolean('İ', 'es')).toBeUndefined();
  });
});
