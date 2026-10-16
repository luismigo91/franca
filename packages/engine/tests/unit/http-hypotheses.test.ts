import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH } from '../../src/constants.js';
import { mapResponse } from '../../src/http/response-map.js';
import { buildRequestUrl, encodeUrlValue, validateUrlText } from '../../src/http/url.js';
import { prepareRequest } from '../../src/http/request.js';
import { ValueTooLargeError } from '../../src/template.js';
import type { VariableValue } from '../../src/types.js';
import { node } from '../helpers/http-node.js';
import { prng } from '../helpers/regex.js';

describe('Hipótesis: codificar un valor cuesta ≤ 8192 unidades', () => {
  it('10⁷ «a» seguidos de un sustituto suelto con presupuesto 8192 → demasiado largo, no «sustituto» (no llegó al final)', () => {
    const text = 'a'.repeat(10_000_000) + '\ud800';
    let error: unknown;
    try {
      encodeUrlValue(text, MAX_URL_LENGTH);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ValueTooLargeError);
  });

  it('el mismo sustituto con un texto que cabe sí se reconoce como sustituto', () => {
    let error: unknown;
    try {
      encodeUrlValue('a\ud800', MAX_URL_LENGTH);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ValueTooLargeError);
  });

  it('codificar no encoge: la longitud codificada ≥ la escrita', () => {
    const rand = prng(11);
    const alphabet = ['a', 'Z', '0', '-', '.', '_', '~', '/', ' ', '%', 'é', '中', '\u{1F600}', '!', '*'];
    for (let i = 0; i < 3000; i++) {
      const text = Array.from({ length: Math.floor(rand() * 20) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
      expect(encodeUrlValue(text, 10_000).length).toBeGreaterThanOrEqual(text.length);
    }
  });
});

describe('Hipótesis: lo validado es lo que el host reparsea', () => {
  it('toda URL aceptada de un barrido cumple new URL(href).href === href', () => {
    const rand = prng(5);
    const pieces = ['a', 'B', '/', '?', '=', '&', '%20', '%C3%B1', 'é', '中', '~', '.', '-', ':80', '%', '%zz', '\u{1F600}'];
    let accepted = 0;
    for (let i = 0; i < 4000; i++) {
      const tail = Array.from({ length: Math.floor(rand() * 8) }, () => pieces[Math.floor(rand() * pieces.length)]).join('');
      for (const base of ['https://api.example.com/', 'http://API.example.com:80/x/', 'https://xn--exmple-qta.com:8443/']) {
        const href = validateUrlText(base + tail);
        if (href === undefined) continue;
        accepted++;
        expect(new URL(href).href, base + tail).toBe(href);
      }
    }
    expect(accepted).toBeGreaterThan(1000);
  });
});

describe('Hipótesis: ningún disfraz de IP o loopback pasa (isDomainName mira el host serializado)', () => {
  it.each([
    // decimal, octal, hexadecimal y formas cortas
    'http://2130706433/', 'http://017700000001/', 'http://0x7f000001/', 'http://0x7F.0.0.1/', 'http://127.1/', 'http://127.0.1/', 'http://0/', 'http://0.0.0.0/',
    // dígitos y puntos anchos
    'http://１２７.０.０.１/', 'http://127。0。0。1/', 'http://１２７．０．０．１/',
    // IPv6 y v4 mapeada
    'http://[::1]/', 'http://[0:0:0:0:0:0:0:1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[fe80::1]/', 'http://[fc00::1]:8080/',
    // localhost y sufijo
    'http://localhost/', 'http://localhost./', 'http://LOCALHOST/', 'http://LocalHost:3000/', 'http://api.localhost/', 'http://API.LOCALHOST/', 'http://a.b.localhost./',
    // privadas y metadatos
    'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/', 'http://100.64.0.1/',
    // otras formas numéricas que el parser convierte en IPv4
    'http://12345/', 'http://1.5/', 'http://600123456/', 'http://1.2.3/', 'http://1.2.3.4./',
  ])('%j → inválida', (url) => {
    expect(validateUrlText(url)).toBeUndefined();
  });

  it('una etiqueta que contiene localhost pero no es el sufijo sí se admite', () => {
    expect(validateUrlText('http://localhostx.com/')).toBe('http://localhostx.com/');
  });
});

describe('Hipótesis: el host nunca lleva %', () => {
  it.each([
    'https://api%2eexample.com/',
    'https://exa%C2%ADmple.com/',
    'https://%31%32%37.0.0.1/',
    'https://%31%32%37%2e0%2e0%2e1/',
    'https://api.example.com%2f/',
    'https://api.example.com%/x',
    'https://api.example.com%?q=1',
    'https:///api%2eexample.com/',
    'https:////exa%E2%80%8Bmple.com/',
    'https://%/',
  ])('%j → inválida', (url) => {
    expect(validateUrlText(url)).toBeUndefined();
  });

  it('y también cuando el % lo trae un valor insertado: se codifica a %25 y el host lo rechaza', () => {
    const lookup = (name: string): VariableValue | undefined => (name === 'v' ? '%2e' : undefined);
    expect(buildRequestUrl('https://api{{v}}example.com/', lookup).ok).toBe(false);
  });
});

describe('Hipótesis: mapear no recursa sobre datos del servidor', () => {
  it('JSON.parse de 524 288 niveles (1 MiB de «[») no lanza en este runtime', () => {
    const body = '['.repeat(524_288) + ']'.repeat(524_288);
    expect(body.length).toBe(1_048_576);
    expect(() => JSON.parse(body)).not.toThrow();
  });

  it('y JSON.stringify de ese valor sí lanza: por eso hay que medir antes de copiar', () => {
    const doc = JSON.parse('['.repeat(524_288) + ']'.repeat(524_288));
    expect(() => JSON.stringify(doc)).toThrow(RangeError);
  });

  it('un puntero vacío sobre 100 000 niveles → invalid_response y la llamada termina', () => {
    const body = '['.repeat(100_000) + ']'.repeat(100_000);
    expect(mapResponse(body, [{ variable: 'v', pointer: '' }])).toEqual({ ok: false });
  });

  it('un puntero vacío sobre 524 288 niveles tampoco recursa', () => {
    const body = '['.repeat(524_288) + ']'.repeat(524_288);
    expect(mapResponse(body, [{ variable: 'v', pointer: '' }])).toEqual({ ok: false });
  });
});

describe('Hipótesis: el body retiene ≤ 65536 + 16384 unidades', () => {
  it('la serialización JSON mide al menos la suma de las longitudes de sus strings', () => {
    const rand = prng(21);
    const alphabet = ['a', '"', '\\', '\n', 'é', '\u{1F600}', '\u0001'];
    const strings = (): string => Array.from({ length: Math.floor(rand() * 10) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
    const body = (depth: number): unknown => {
      const r = rand();
      if (depth === 0 || r < 0.4) return strings();
      if (r < 0.7) return Array.from({ length: Math.floor(rand() * 4) }, () => body(depth - 1));
      return Object.fromEntries(Array.from({ length: Math.floor(rand() * 4) }, (_, i) => [`k${i}`, body(depth - 1)]));
    };
    const sum = (value: unknown): number =>
      typeof value === 'string' ? value.length : Array.isArray(value) ? value.reduce((acc: number, v) => acc + sum(v), 0) : typeof value === 'object' && value !== null ? Object.values(value).reduce((acc: number, v) => acc + sum(v), 0) : 0;
    for (let i = 0; i < 2000; i++) {
      const doc = body(4);
      expect(JSON.stringify(doc).length).toBeGreaterThanOrEqual(sum(doc));
    }
  });

  it('1000 strings de 16384 seguidos de uno de 16385 dan value_too_large (el tamaño gana)', () => {
    const doc = [...Array.from({ length: 1000 }, () => '{{a}}'), '{{b}}'];
    const lookup = (name: string): VariableValue | undefined => (name === 'a' ? 'a'.repeat(16384) : 'b'.repeat(16385));
    expect(() => prepareRequest(node({ method: 'POST', body: doc }), lookup, new Set())).toThrow(ValueTooLargeError);
  });
});
