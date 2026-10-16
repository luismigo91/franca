import { describe, expect, it } from 'vitest';
import { PARSERS } from '../../src/input/parsers/index.js';

const phone = PARSERS.phone;
const number = PARSERS.number;

describe('Tipo phone', () => {
  it.each([
    ['+34 600-12-34-56', '+34600123456'],
    ['(91) 123 45 67', '911234567'],
    ['0034 600.123.456', '0034600123456'],
    ['600\u00a0123\u00a0456', '600123456'],
    ['600\u202f123\u202f456', '600123456'],
    ['600\u2003123\u2003456', '600123456'],
    ['1234567', '1234567'],
    ['123456789012345', '123456789012345'],
    ['+123456789012345', '+123456789012345'],
    ['((600)))123 456', '600123456'],
  ])('%j → %j', (text, value) => {
    expect(phone(text, 'es')).toBe(value);
  });

  it.each([
    '123456',
    '1234567890123456',
    '+1234567890123456',
    '600 12 34 5a',
    '34+600123456',
    '++34600123456',
    '+',
    '+ ',
    '٦٠٠١٢٣٤٥٦',
    '600/123/456',
    '600_123_456',
    '+34 600 123 456 ext',
    '６００１２３４５６',
  ])('%j es inválido', (text) => {
    expect(phone(text, 'es')).toBeUndefined();
  });
});

describe('Tipo number', () => {
  it.each([
    ['42', 42],
    ['-3,5', -3.5],
    ['+0.25', 0.25],
    ['1234.567', 1234.567],
    ['0,500', 0.5],
    ['007', 7],
    ['-0', 0],
    ['1.5', 1.5],
    ['12.34', 12.34],
    ['1234,5678', 1234.5678],
    ['1.5000', 1.5],
    ['0.000', 0],
  ])('%j → %j', (text, value) => {
    const result = number(text, 'es');
    expect(result).toBe(value);
    expect(Object.is(result, -0)).toBe(false);
  });

  it.each(['1.500', '1,500', '-2.000', '999.999', '+1,000', '12.345', '123,456', '10.500'])('%j es ambiguo e inválido', (text) => {
    expect(number(text, 'es')).toBeUndefined();
  });

  it.each([
    '.5',
    '5.',
    '1 000',
    '1.000.000',
    '1e3',
    '1E3',
    '0x10',
    '١٢',
    '9'.repeat(400),
    '',
    '-',
    '+',
    '--1',
    '1-',
    '1,5,5',
    '1..5',
    '１２',
    'NaN',
    'Infinity',
  ])('%j es inválido', (text) => {
    expect(number(text, 'es')).toBeUndefined();
  });

  it('15 y 16 cifras significativas', () => {
    expect(number('123456789012345', 'es')).toBe(123456789012345);
    expect(number('1234567890123456', 'es')).toBeUndefined();
    expect(number('0,00000000000000012345', 'es')).toBe(1.2345e-16);
    expect(number(`1${'0'.repeat(21)}`, 'es')).toBe(1e21);
    expect(number('1234567890123,45', 'es')).toBe(1234567890123.45);
    expect(number('1234567890123,456', 'es')).toBeUndefined(); // 16 cifras
    expect(number('0.1234567890123456', 'es')).toBeUndefined();
    expect(number('0000000000000000000000001', 'es')).toBe(1);
  });

  it('desbordamiento, subdesbordamiento y subnormales', () => {
    expect(number(`1${'0'.repeat(309)}`, 'es')).toBeUndefined();
    expect(number(`1${'0'.repeat(308)}`, 'es')).toBe(1e308);
    expect(number(`0,${'0'.repeat(307)}1`, 'es')).toBeUndefined(); // 1e-308
    expect(number(`0,${'0'.repeat(306)}1`, 'es')).toBe(1e-307);
    expect(number(`0,${'0'.repeat(400)}1`, 'es')).toBeUndefined();
    expect(number(`-0,${'0'.repeat(306)}1`, 'es')).toBe(-1e-307);
  });

  it('ceros', () => {
    for (const text of ['0', '-0,0', '0000,0000', '+0', '0,000000000000000000000000000000000000']) {
      const value = number(text, 'es');
      expect(Object.is(value, 0), text).toBe(true);
    }
  });

  it('un number aceptado se guarda sin redondeo: su forma textual denota el mismo decimal', () => {
    for (const text of ['0,1', '0.3', '123456789012345', '1.2345678901234', '0.000123', '99999999999999.9']) {
      const value = number(text, 'es') as number;
      expect(Number(JSON.stringify(value))).toBe(value);
      expect(value).toBe(Number(text.replace(',', '.')));
    }
  });
});
