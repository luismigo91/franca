import { describe, expect, it } from 'vitest';
import { PARSERS } from '../../src/input/parsers/index.js';

const email = PARSERS.email;

describe('Tipo text', () => {
  it('se guarda lo escrito, sin normalizar', () => {
    for (const text of ['Ana', '<b>Hola</b>\nsegunda línea', 'é', '😀', 'a  b']) {
      expect(PARSERS.text(text, 'es')).toBe(text);
    }
  });
});

describe('Tipo email', () => {
  it.each([
    ['ana@example.com', 'ana@example.com'],
    ['Ana.Perez+lead@Example.COM', 'Ana.Perez+lead@example.com'],
    ["o'brien@sub.example.co.uk", "o'brien@sub.example.co.uk"],
    ['a..b@example.com', 'a..b@example.com'],
    ["!#$%&'*+/=?^_`{|}~-@example.com", "!#$%&'*+/=?^_`{|}~-@example.com"],
    ['ana@xn--exmple-qta.com', 'ana@xn--exmple-qta.com'],
    ['ana@a-b.example.com', 'ana@a-b.example.com'],
    ['ana@example.c0m', 'ana@example.c0m'],
    ['ana@example.co', 'ana@example.co'],
  ])('%s es válido', (text, value) => {
    expect(email(text, 'es')).toBe(value);
  });

  it.each([
    'ana',
    'ana@',
    '@example.com',
    'ana@example',
    'ana @example.com',
    'a@b@example.com',
    'ana@example.c',
    'ana@example.123',
    'ana@-example.com',
    'ana@example-.com',
    'ana@.example.com',
    'ana@example..com',
    'ana@example.com.',
    'añá@example.com',
    'ana@exámple.com',
    'ana@[127.0.0.1]',
    'ana@127.0.0.1',
    'ana(comentario)@example.com',
    'ana,b@example.com',
    '',
  ])('%j es inválido', (text) => {
    expect(email(text, 'es')).toBeUndefined();
  });

  it('parte local de 64 y 65 caracteres', () => {
    expect(email(`${'a'.repeat(64)}@example.com`, 'es')).toBe(`${'a'.repeat(64)}@example.com`);
    expect(email(`${'a'.repeat(65)}@example.com`, 'es')).toBeUndefined();
  });

  it('longitud total de 254 y 255', () => {
    const label = 'b'.repeat(63);
    const build = (total: number) => {
      const domain = `${label}.${label}.${label}.com`; // 63*3 + 3 puntos... = 192
      const local = 'a'.repeat(total - domain.length - 1);
      return `${local}@${domain}`;
    };
    // local de 59 y 60 caracteres: dentro del límite de 64
    expect(build(254)).toHaveLength(254);
    expect(email(build(254), 'es')).toBe(build(254));
    expect(email(build(255), 'es')).toBeUndefined();
  });

  it('etiquetas de 63 y 64 caracteres', () => {
    expect(email(`ana@${'a'.repeat(63)}.com`, 'es')).toBeDefined();
    expect(email(`ana@${'a'.repeat(64)}.com`, 'es')).toBeUndefined();
  });
});
