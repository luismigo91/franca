import { describe, expect, it } from 'vitest';
import { asText } from '@/lib/editor/as-text';

describe('asText', () => {
  it('un texto, tal cual', () => {
    expect(asText('Hola <b>x</b>')).toBe('Hola <b>x</b>');
    expect(asText('')).toBe('');
  });

  it('cualquier otro valor, con JSON.stringify, y nunca [object Object]', () => {
    expect(asText({})).toBe('{}');
    expect(asText([])).toBe('[]');
    expect(asText(5)).toBe('5');
    expect(asText(null)).toBe('null');
    expect(asText(true)).toBe('true');
    expect(asText({ es: 'Saludo' })).toBe('{"es":"Saludo"}');
  });

  it('undefined da vacío', () => {
    expect(asText(undefined)).toBe('');
  });
});
