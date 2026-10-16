import { describe, expect, it } from 'vitest';
import { prepareRules } from '../../src/input/validation.js';
import { choiceNode, inputNode } from '../helpers/input-node.js';

const invalid = (node: ReturnType<typeof inputNode>) => {
  const result = prepareRules(node);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.message;
};

describe('prepareRules: patrón', () => {
  it.each(['(', '(a)\\1', 'a{1001}', '('.repeat(101) + 'a' + ')'.repeat(101), 'a(?=a)', '[', '*'])('%j no se puede aplicar', (pattern) => {
    expect(invalid(inputNode('text', { validation: { pattern } }))).toContain('la validación del nodo no se puede aplicar');
  });

  it('el mensaje nombra la causa y no el patrón', () => {
    expect(invalid(inputNode('text', { validation: { pattern: '(a)\\1' } }))).not.toContain('(a)');
  });

  it('un patrón válido produce un programa', () => {
    const result = prepareRules(inputNode('text', { validation: { pattern: '^\\d{5}$' } }));
    expect(result.ok && result.rules.program).not.toBeNull();
  });

  it('sin patrón no hay programa', () => {
    const result = prepareRules(inputNode('text'));
    expect(result).toEqual({ ok: true, rules: { min: undefined, max: undefined, program: null } });
  });
});

describe('prepareRules: límites imposibles', () => {
  it('min > max en text, number y selección múltiple', () => {
    expect(invalid(inputNode('text', { validation: { min: 5, max: 2 } }))).toContain('min es mayor que max');
    expect(invalid(inputNode('number', { validation: { min: 5, max: 2 } }))).toContain('min es mayor que max');
    expect(invalid(choiceNode(['a', 'b', 'c'], { multiple: true, validation: { min: 3, max: 2 } }))).toContain('min es mayor que max');
  });

  it('max < 1 en text y en múltiple', () => {
    expect(invalid(inputNode('text', { validation: { max: 0 } }))).toContain('max');
    expect(invalid(choiceNode(['a'], { multiple: true, validation: { max: 0 } }))).toContain('max');
    expect(invalid(inputNode('text', { validation: { max: 0.5 } }))).toContain('max');
  });

  it('min mayor que el número de opciones en múltiple', () => {
    expect(invalid(choiceNode(['a', 'b', 'c'], { multiple: true, validation: { min: 4 } }))).toContain('opciones');
  });

  it('min igual al número de opciones es posible', () => {
    expect(prepareRules(choiceNode(['a', 'b', 'c'], { multiple: true, validation: { min: 3 } })).ok).toBe(true);
  });

  it('max negativo en number es alcanzable', () => {
    expect(prepareRules(inputNode('number', { validation: { max: -5 } })).ok).toBe(true);
    expect(prepareRules(inputNode('number', { validation: { min: -10, max: -5 } })).ok).toBe(true);
  });

  it('min == max es posible', () => {
    expect(prepareRules(inputNode('text', { validation: { min: 3, max: 3 } })).ok).toBe(true);
  });
});

describe('prepareRules: lo que se ignora por tipo', () => {
  it.each(['email', 'phone', 'url', 'date', 'boolean'])('%s ignora min/max imposibles', (type) => {
    const result = prepareRules(inputNode(type, { validation: { min: 100, max: 1 } }));
    expect(result).toEqual({ ok: true, rules: { program: null } });
  });

  it('choice única ignora pattern, min y max', () => {
    const node = choiceNode(['a', 'b'], { validation: { pattern: '(', min: 5, max: 2 } });
    expect(prepareRules(node)).toEqual({ ok: true, rules: { program: null } });
  });

  it('choice múltiple ignora pattern pero aplica límites', () => {
    const node = choiceNode(['a', 'b'], { multiple: true, validation: { pattern: '(', min: 1, max: 2 } });
    expect(prepareRules(node)).toEqual({ ok: true, rules: { min: 1, max: 2, program: null } });
  });

  it('un tipo que ignora los límites aplica el patrón', () => {
    const result = prepareRules(inputNode('email', { validation: { pattern: '(' } }));
    expect(result.ok).toBe(false);
  });
});
