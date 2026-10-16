import { describe, expect, it } from 'vitest';
import { MAX_INPUT_LENGTH } from '../../src/constants.js';
import { isDomainName } from '../../src/input/parsers/domain.js';
import { PARSERS } from '../../src/input/parsers/index.js';

const url = PARSERS.url;

describe('Tipo url', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['HTTP://Example.com/a?b=1', 'http://example.com/a?b=1'],
    ['www.example.com/precios', 'https://www.example.com/precios'],
    ['HTTPS://EXAMPLE.COM', 'https://example.com/'],
    ['exámple.com', 'https://xn--exmple-qta.com/'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['example.com/a%20b', 'https://example.com/a%20b'],
    ['example.com/ñ', 'https://example.com/%C3%B1'],
    ['example.com/#frag', 'https://example.com/#frag'],
    ['a-b.example.co.uk', 'https://a-b.example.co.uk/'],
    ['example.com?q=1', 'https://example.com/?q=1'],
  ])('%j → %j', (text, value) => {
    expect(url(text, 'es')).toBe(value);
  });

  it.each([
    'ftp://example.com',
    'javascript:alert(1)',
    'mailto:ana@example.com',
    'https://user:pass@example.com',
    'https://user@example.com',
    'user@example.com',
    'https://localhost',
    'http://',
    'https://',
    'exa mple.com',
    'file:///etc/passwd',
    'data:text/html,hola',
    'example.com://x',
  ])('%j es inválida', (text) => {
    expect(url(text, 'es')).toBeUndefined();
  });

  it('esquemas http/https sin distinguir mayúsculas, solo en el prefijo', () => {
    expect(url('hTtP://example.com', 'es')).toBe('http://example.com/');
    expect(url('xhttp://example.com', 'es')).toBeUndefined();
  });
});

describe('Host de una url', () => {
  it.each([
    '12345',
    '1.5',
    '2130706433',
    '600123456',
    '192.168.1.1',
    '127.1',
    '0x7f.1',
    '0x7f000001',
    'https://[::1]',
    'https://[2001:db8::1]',
    'a.b',
    'example.com.',
    'example.123',
    'a.',
    '-example.com',
    'example-.com',
    'exa_mple.com',
  ])('%j no es un dominio', (text) => {
    expect(url(text, 'es')).toBeUndefined();
  });

  it('dominio internacional', () => {
    expect(url('exámple.com', 'es')).toBe('https://xn--exmple-qta.com/');
  });

  it('isDomainName: etiquetas y última etiqueta', () => {
    expect(isDomainName('example.com')).toBe(true);
    expect(isDomainName('xn--exmple-qta.com')).toBe(true);
    expect(isDomainName('a.co')).toBe(true);
    expect(isDomainName('a.b')).toBe(false);
    expect(isDomainName('example')).toBe(false);
    expect(isDomainName('')).toBe(false);
    expect(isDomainName('example.12')).toBe(false);
    expect(isDomainName('example.1a')).toBe(true);
    expect(isDomainName(`${'a'.repeat(63)}.com`)).toBe(true);
    expect(isDomainName(`${'a'.repeat(64)}.com`)).toBe(false);
    expect(isDomainName('[::1]')).toBe(false);
  });
});

describe('Espacios y controles en una url', () => {
  it.each([
    'example.com/precios y más',
    'exa\tmple.com',
    'example.com\n/precios',
    'example.com/\u0000',
    'example.com/\u007f',
    'example.com/\u001f',
    'example.com/a b',
    'example.com/a b',
    'exa\rmple.com',
  ])('%j es inválida', (text) => {
    expect(url(text, 'es')).toBeUndefined();
  });

  it.each([
    ['soft hyphen', 'ex­ample.com'],
    ['zero width space', 'ex​ample.com'],
    ['BOM', 'example.com/﻿'],
    ['ZWJ', 'example.com/‍'],
    ['selector de variación', 'example.com/a️'],
    ['selector suplementario', 'example.com/\u{e0100}'],
    ['word joiner', 'ex⁠ample.com'],
    ['mongol', 'ex᠋ample.com'],
    ['sustituto alto suelto', 'example.com/\ud800'],
    ['sustituto bajo suelto', 'example.com/\udc00'],
  ])('%s es inválida', (_name, text) => {
    expect(url(text, 'es')).toBeUndefined();
  });

  it('un emoji completo en la ruta se codifica', () => {
    expect(url('example.com/😀', 'es')).toBe('https://example.com/%F0%9F%98%80');
  });
});

describe('Tamaño máximo del valor guardado en una url', () => {
  it('679 ñ → 4094 unidades aceptadas; 680 → 4100 rechazadas', () => {
    const ok = url(`example.com/${'ñ'.repeat(679)}`, 'es') as string;
    expect(ok).toHaveLength(4094);
    expect(url(`example.com/${'ñ'.repeat(680)}`, 'es')).toBeUndefined();
  });

  it('el límite es exacto: href de 4096 aceptado y de 4097 rechazado', () => {
    const base = 'https://example.com/';
    expect(url(`example.com/${'a'.repeat(MAX_INPUT_LENGTH - base.length)}`, 'es')).toHaveLength(MAX_INPUT_LENGTH);
    expect(url(`example.com/${'a'.repeat(MAX_INPUT_LENGTH - base.length + 1)}`, 'es')).toBeUndefined();
  });

  it('4096 unidades de 中 en la ruta se rechazan (×9 al codificar)', () => {
    expect(url(`example.com/${'中'.repeat(4083)}`, 'es')).toBeUndefined();
  });
});
