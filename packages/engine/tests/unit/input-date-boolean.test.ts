import { describe, expect, it } from 'vitest';
import { PARSERS } from '../../src/input/parsers/index.js';

const date = PARSERS.date;
const bool = PARSERS.boolean;

describe('Tipo date', () => {
  it.each([
    '2026-10-16',
    '2024-02-29',
    '2000-02-29',
    '1900-01-01',
    '0001-01-01',
    '9999-12-31',
    '2026-01-31',
    '2026-04-30',
    '2026-02-28',
  ])('%s es válida y se guarda igual', (text) => {
    expect(date(text, 'es')).toBe(text);
  });

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2100-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-10-32',
    '2026-04-31',
    '2026-1-5',
    '16/10/2026',
    '2026-10-16T10:00',
    '20261016',
    '0000-01-01',
    '2026/10/16',
    '2026-10-16 ',
    '٢٠٢٦-١٠-١٦',
    '202a-10-16',
    '+026-10-16',
    '',
  ])('%j es inválida', (text) => {
    expect(date(text, 'es')).toBeUndefined();
  });
});

describe('Tipo boolean', () => {
  it.each([
    ['es', 'Sí', true],
    ['es', 'SI', true],
    ['es', 'si', true],
    ['es', 'true', true],
    ['es', 'No', false],
    ['es', 'FALSE', false],
    ['en', 'Yes', true],
    ['en', 'y', true],
    ['en', 'N', false],
    ['en', 'no', false],
    ['en', 'TRUE', true],
    ['fr', 'true', true],
    ['fr', 'false', false],
    ['fr', 'oui', undefined],
    ['es', 'vale', undefined],
    ['es', 's', undefined],
    ['es', 'yes', undefined],
    ['es', '1', undefined],
    ['en', 'sí', undefined],
    ['es', 'ye s', undefined],
  ])('(%s) %j → %j', (language, text, value) => {
    expect(bool(text, language)).toBe(value);
  });

  it('un acento combinante se normaliza a NFC', () => {
    expect(bool('si\u0301', 'es')).toBe(true);
    expect(bool('Si\u0301', 'es')).toBe(true);
  });

  it('İ y Sİ no dependen del locale del host', () => {
    expect(bool('İ', 'es')).toBeUndefined();
    expect(bool('Sİ', 'es')).toBeUndefined();
    expect(bool('NO', 'es')).toBe(false);
  });
});
