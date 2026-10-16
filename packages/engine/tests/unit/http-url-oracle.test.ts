import { describe, expect, it } from 'vitest';
import { buildRequestUrl, encodeUrlValue, validateUrlText } from '../../src/http/url.js';
import type { VariableValue } from '../../src/types.js';
import { prng } from '../helpers/regex.js';

const lookup = (v: string) => (name: string): VariableValue | undefined => (name === 'v' ? v : undefined);

/** Alfabeto con los caracteres que podrían cambiar origen, ruta o consulta, no ASCII, emoji y mitades de sustituto. */
const ALPHABET = [
  'a', 'b', 'Z', '0', '9', '/', '?', '#', '@', ':', '%', '\\', '.', '~', '-', '_', ' ', '&', '=', '+', '!', "'", '(', ')', '*',
  'é', '中', '\u{1F600}', '\ud800', '\udc00', '\u2028', '\u00ad', '\u200b',
];

function generateText(rand: () => number): string {
  const length = Math.floor(rand() * 12);
  return Array.from({ length }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join('');
}

/** Definición carácter a carácter: UTF-8 en %XX mayúsculas salvo los 66 no reservados. */
function encodeByDefinition(text: string): string | undefined {
  let out = '';
  for (const c of text) {
    const cp = c.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) return undefined;
    if (/^[A-Za-z0-9\-._~]$/.test(c)) {
      out += c;
      continue;
    }
    const bytes = new TextEncoder().encode(c);
    for (const byte of bytes) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

describe('oráculo: un valor no cambia origen, ruta ni consulta', () => {
  it('https://api.example.com/x/{{v}}?q={{v}} es inválida o conserva origen, 2 segmentos y una clave q con el valor', () => {
    const rand = prng(20261017);
    const template = 'https://api.example.com/x/{{v}}?q={{v}}';
    let accepted = 0;
    let rejected = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      const v = generateText(rand);
      const built = buildRequestUrl(template, lookup(v));
      const hasLoneSurrogate = encodeByDefinition(v) === undefined;
      if (!built.ok) {
        rejected++;
        // solo puede rechazar por un sustituto suelto o por un segmento de punto
        expect(hasLoneSurrogate || v === '.' || v === '..', JSON.stringify(v)).toBe(true);
        continue;
      }
      accepted++;
      const url = new URL(built.url);
      expect(url.origin, JSON.stringify(v)).toBe('https://api.example.com');
      expect(url.pathname.split('/'), JSON.stringify(v)).toHaveLength(3); // '', 'x', valor
      expect([...url.searchParams.keys()]).toEqual(['q']);
      expect(decodeURIComponent(url.pathname.split('/')[2]!)).toBe(v);
      expect(url.searchParams.get('q')).toBe(v);
      expect(url.hash).toBe('');
      expect(new URL(built.url).href).toBe(built.url);
    }
    expect(accepted / total).toBeGreaterThan(0.5);
    expect(rejected / total).toBeGreaterThan(0.05);
  });

  it('el valor también como parte del host (https://{{v}}.example.com/) conserva el origen o es inválido', () => {
    const rand = prng(99);
    let accepted = 0;
    for (let i = 0; i < 3000; i++) {
      const v = generateText(rand);
      const built = buildRequestUrl('https://{{v}}.example.com/x', lookup(v));
      if (!built.ok) continue;
      accepted++;
      const url = new URL(built.url);
      // solo caracteres no reservados: el host termina en .example.com y no hay userinfo, puerto ni ruta añadidos
      expect(url.hostname.endsWith('.example.com'), JSON.stringify(v)).toBe(true);
      expect(url.username + url.password + url.port).toBe('');
      expect(url.pathname).toBe('/x');
    }
    expect(accepted).toBeGreaterThan(50);
  });
});

describe('oráculo: encodeUrlValue contra la definición', () => {
  it('coincide en textos generados', () => {
    const rand = prng(7);
    for (let i = 0; i < 4000; i++) {
      const text = generateText(rand);
      const expected = encodeByDefinition(text);
      if (expected === undefined) expect(() => encodeUrlValue(text, 1000), JSON.stringify(text)).toThrow();
      else expect(encodeUrlValue(text, 1000), JSON.stringify(text)).toBe(expected);
    }
  });

  it('codificar nunca encoge', () => {
    const rand = prng(8);
    for (let i = 0; i < 4000; i++) {
      const text = generateText(rand);
      if (encodeByDefinition(text) === undefined) continue;
      expect(encodeUrlValue(text, 1000).length).toBeGreaterThanOrEqual(text.length);
    }
  });
});

describe('oráculo: segmentos de punto contra WHATWG', () => {
  const SEGMENTS = ['.', '..', '%2e', '%2E', '.%2e', '%2e.', '%2E%2e', '..a', '...', '%252e', 'a', ''];

  it('si el motor acepta, WHATWG no colapsó nada; si rechaza, WHATWG sí cambiaba la ruta', () => {
    const rand = prng(31337);
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 4000; i++) {
      const count = 1 + Math.floor(rand() * 4);
      const path = '/' + Array.from({ length: count }, () => SEGMENTS[Math.floor(rand() * SEGMENTS.length)]).join('/');
      const url = `https://api.example.com${path}`;
      const normalized = new URL(url).pathname;
      if (validateUrlText(url) !== undefined) {
        accepted++;
        expect(normalized, url).toBe(path);
      } else {
        rejected++;
        expect(normalized, url).not.toBe(path);
      }
    }
    expect(accepted / 4000).toBeGreaterThan(0.1);
    expect(rejected / 4000).toBeGreaterThan(0.1);
  });
});
