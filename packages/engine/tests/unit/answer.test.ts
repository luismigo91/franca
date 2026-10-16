import { describe, expect, it } from 'vitest';
import { MAX_INPUT_LENGTH } from '../../src/constants.js';
import { checkChoices, checkTextAnswer, countCodePoints } from '../../src/input/answer.js';
import { prepareRules, type AnswerRules } from '../../src/input/validation.js';
import { choiceNode, inputNode } from '../helpers/input-node.js';

const rulesOf = (type: string, validation?: Record<string, unknown>): AnswerRules => {
  const result = prepareRules(inputNode(type, validation ? { validation } : {}));
  if (!result.ok) throw new Error(result.message);
  return result.rules;
};
const check = (raw: string, type: Parameters<typeof checkTextAnswer>[1], validation?: Record<string, unknown>) =>
  checkTextAnswer(raw, type, 'es', rulesOf(type, validation));

describe('checkTextAnswer: cada reason', () => {
  it('too_long', () => expect(check('a'.repeat(MAX_INPUT_LENGTH + 1), 'text')).toEqual({ ok: false, reason: 'too_long' }));
  it('required', () => expect(check('  \n ', 'text')).toEqual({ ok: false, reason: 'required' }));
  it('invalid_format', () => expect(check('ana', 'email')).toEqual({ ok: false, reason: 'invalid_format' }));
  it('out_of_range', () => expect(check('1', 'number', { min: 5 })).toEqual({ ok: false, reason: 'out_of_range' }));
  it('pattern_mismatch', () => expect(check('abc', 'text', { pattern: '^\\d+$' })).toEqual({ ok: false, reason: 'pattern_mismatch' }));
  it('válida', () => expect(check(' Ana ', 'text')).toEqual({ ok: true, value: 'Ana' }));
});

describe('Orden de comprobación', () => {
  it('El rango gana al patrón', () => {
    expect(check('5', 'number', { min: 10, pattern: '^1' })).toEqual({ ok: false, reason: 'out_of_range' });
  });
  it('El formato gana al patrón', () => {
    expect(check('ana', 'email', { pattern: '@empresa\\.com$' })).toEqual({ ok: false, reason: 'invalid_format' });
  });
  it('Vacía gana a los límites', () => {
    expect(check('   ', 'text', { min: 3 })).toEqual({ ok: false, reason: 'required' });
  });
  it('too_long gana a required: 4097 espacios', () => {
    expect(check(' '.repeat(MAX_INPUT_LENGTH + 1), 'text')).toEqual({ ok: false, reason: 'too_long' });
    expect(check(' '.repeat(MAX_INPUT_LENGTH), 'text')).toEqual({ ok: false, reason: 'required' });
  });
  it('too_long gana al formato y se mide sin recortar', () => {
    const padded = ' '.repeat(2049) + 'Ana' + ' '.repeat(2045);
    expect(padded).toHaveLength(MAX_INPUT_LENGTH + 1);
    expect(check(padded, 'text')).toEqual({ ok: false, reason: 'too_long' });
    expect(check(padded.slice(1), 'text')).toEqual({ ok: true, value: 'Ana' });
  });
  it('un nulo o sustituto suelto es invalid_format incluso en text', () => {
    for (const bad of ['Ana\u0000', 'Ana\ud800', '\udc00Ana']) expect(check(bad, 'text')).toEqual({ ok: false, reason: 'invalid_format' });
    expect(check('Ana 😀', 'text')).toEqual({ ok: true, value: 'Ana 😀' });
  });
  it('invalid_format gana a out_of_range (un nulo en un text con max)', () => {
    expect(check('a\u0000b', 'text', { max: 1 })).toEqual({ ok: false, reason: 'invalid_format' });
  });
});

describe('min y max', () => {
  it('cuentan code points en text', () => {
    expect(check('😀😀', 'text', { min: 2, max: 5 })).toEqual({ ok: true, value: '😀😀' });
    expect(check('A', 'text', { min: 2, max: 5 })).toEqual({ ok: false, reason: 'out_of_range' });
    expect(check('abcdef', 'text', { min: 2, max: 5 })).toEqual({ ok: false, reason: 'out_of_range' });
    expect(check('😀😀😀😀😀😀', 'text', { max: 5 })).toEqual({ ok: false, reason: 'out_of_range' });
  });
  it('son inclusivos y admiten fraccionarios', () => {
    expect(check('18', 'number', { min: 18, max: 99 }).ok).toBe(true);
    expect(check('99', 'number', { min: 18, max: 99 }).ok).toBe(true);
    expect(check('99,5', 'number', { min: 18, max: 99 })).toEqual({ ok: false, reason: 'out_of_range' });
    expect(check('Ana', 'text', { min: 1.5 }).ok).toBe(true);
    expect(check('A', 'text', { min: 1.5 })).toEqual({ ok: false, reason: 'out_of_range' });
    expect(check('abc', 'text', { max: 2.5 })).toEqual({ ok: false, reason: 'out_of_range' });
    expect(check('ab', 'text', { max: 2.5 }).ok).toBe(true);
  });
  it('se aplican al texto recortado', () => {
    expect(check('  ab  ', 'text', { min: 2, max: 2 })).toEqual({ ok: true, value: 'ab' });
  });
  it('los tipos que los ignoran los ignoran', () => {
    expect(check('ana@example.com', 'email', { min: 100 }).ok).toBe(true);
    expect(check('2026-10-16', 'date', { max: 1 }).ok).toBe(true);
  });
});

describe('patrón sobre la forma textual del valor convertido', () => {
  it('teléfono y número', () => {
    expect(check('+34 600 12 34 56', 'phone', { pattern: '^\\+34\\d{9}$' }).ok).toBe(true);
    expect(check('3,5', 'number', { pattern: '^\\d+\\.\\d+$' }).ok).toBe(true);
  });
  it('el patrón no ve los espacios recortados', () => {
    expect(check('  Ana  ', 'text', { pattern: '^Ana$' }).ok).toBe(true);
  });
});

describe('checkChoices', () => {
  const node = choiceNode(['a', 'b', 'c', 'd'], { multiple: true });
  const withValues = choiceNode(['a', 'b', 'c'], {
    multiple: true,
    choices: [
      { id: 'a', label: 'A', value: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C', value: 3 },
    ],
  });
  const rules = (min?: number, max?: number): AnswerRules => ({ min, max, program: null });

  it('vacía es required', () => expect(checkChoices(node, [], rules())).toEqual({ ok: false, reason: 'required' }));
  it('vacía gana a min', () => expect(checkChoices(node, [], rules(2))).toEqual({ ok: false, reason: 'required' }));
  it('min y max sobre el número de opciones', () => {
    expect(checkChoices(node, [0], rules(2, 3))).toEqual({ ok: false, reason: 'out_of_range' });
    expect(checkChoices(node, [0, 1], rules(2, 3)).ok).toBe(true);
    expect(checkChoices(node, [0, 1, 2], rules(2, 3)).ok).toBe(true);
    expect(checkChoices(node, [0, 1, 2, 3], rules(2, 3))).toEqual({ ok: false, reason: 'out_of_range' });
  });
  it('value ?? id en el orden recibido (ya ordenado por el lector)', () => {
    expect(checkChoices(withValues, [0, 1, 2], rules())).toEqual({ ok: true, value: ['A', 'b', 3] });
  });
});

describe('countCodePoints', () => {
  it('cuenta pares como uno y sustitutos sueltos como uno', () => {
    expect(countCodePoints('')).toBe(0);
    expect(countCodePoints('a😀')).toBe(2);
    expect(countCodePoints('\ud800')).toBe(1);
  });
});
