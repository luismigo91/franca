import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH } from '../../src/constants.js';
import { buildRequestUrl, encodeUrlValue, validateUrlText } from '../../src/http/url.js';
import { ValueTooLargeError } from '../../src/template.js';
import type { VariableValue } from '../../src/types.js';

const vars = (values: Record<string, VariableValue>) => (name: string) => (Object.hasOwn(values, name) ? values[name] : undefined);
const build = (template: string, values: Record<string, VariableValue> = {}) => buildRequestUrl(template, vars(values));
const valid = (url: string): string | undefined => validateUrlText(url);

describe('encodeUrlValue', () => {
  it('los 66 no reservados pasan tal cual', () => {
    const unreserved = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    expect(unreserved).toHaveLength(66);
    expect(encodeUrlValue(unreserved, 100)).toBe(unreserved);
  });

  it('cada otro ASCII imprimible se codifica en mayúsculas, incluidos ! \' ( ) *', () => {
    for (let code = 0x20; code < 0x7f; code++) {
      const c = String.fromCharCode(code);
      if (/[A-Za-z0-9\-._~]/.test(c)) continue;
      expect(encodeUrlValue(c, 10), JSON.stringify(c)).toBe(`%${code.toString(16).toUpperCase().padStart(2, '0')}`);
    }
  });

  it.each([
    ['é', '%C3%A9'],
    ['中', '%E4%B8%AD'],
    ['\u{1F600}', '%F0%9F%98%80'],
    ['a b', 'a%20b'],
    ['../admin', '..%2Fadmin'],
    ['', ''],
  ])('%j → %j', (text, expected) => {
    expect(encodeUrlValue(text, 100)).toBe(expected);
  });

  it('un sustituto suelto no se codifica', () => {
    for (const text of ['\ud800', '\udc00', 'a\ud800b', '\ud800\ud800']) expect(() => encodeUrlValue(text, 100)).toThrow();
    expect(() => encodeUrlValue('\ud800', 100)).not.toThrow(ValueTooLargeError);
  });

  it('presupuesto: el texto más largo que lo que queda se rechaza como demasiado largo', () => {
    expect(encodeUrlValue('aaa', 3)).toBe('aaa');
    expect(() => encodeUrlValue('aaaa', 3)).toThrow(ValueTooLargeError);
  });
});

describe('Valores insertados en la URL', () => {
  it('Un valor no cambia la ruta ni la consulta', () => {
    expect(build('https://api.example.com/users/{{id}}?q={{q}}', { id: '../admin', q: 'a b&c=d#e' })).toEqual({
      ok: true,
      url: 'https://api.example.com/users/..%2Fadmin?q=a%20b%26c%3Dd%23e',
    });
  });

  it('Texto no ASCII, números y objetos', () => {
    expect(
      build('https://api.example.com/buscar?nombre={{nombre}}&n={{n}}&d={{d}}&x={{x}}', { nombre: 'José', n: 1500.5, d: { a: 1 } }),
    ).toEqual({ ok: true, url: 'https://api.example.com/buscar?nombre=Jos%C3%A9&n=1500.5&d=%7B%22a%22%3A1%7D&x=' });
  });

  it('Una variable no puede añadir los caracteres / ? # @ :', () => {
    expect(build('{{base}}/x', { base: 'https://api.example.com' }).ok).toBe(false);
    expect(build('https://{{sub}}.example.com/', { sub: 'evil.com/' }).ok).toBe(false);
    expect(build('https://api.example.com/{{v}}', { v: 'a/b?c#d@e:f' })).toEqual({
      ok: true,
      url: 'https://api.example.com/a%2Fb%3Fc%23d%40e%3Af',
    });
  });

  it('Esquema con plantilla', () => {
    expect(build('http{{s}}://api.example.com/', { s: 's' })).toEqual({ ok: true, url: 'https://api.example.com/' });
    expect(build('http{{s}}://api.example.com/', { s: 'x' }).ok).toBe(false);
  });

  it('Etiquetas del host que el autor deja abiertas', () => {
    expect(build('https://{{sub}}.example.com/', { sub: 'api' })).toEqual({ ok: true, url: 'https://api.example.com/' });
    expect(build('https://{{sub}}.example.com/', { sub: 'api.eu' })).toEqual({ ok: true, url: 'https://api.eu.example.com/' });
  });

  it('Sustituto suelto en un valor', () => {
    expect(build('https://api.example.com/?ref={{ref}}', { ref: 'a\ud800' }).ok).toBe(false);
  });

  it('un valor sin valor es cadena vacía', () => {
    expect(build('https://api.example.com/users/{{id}}/x')).toEqual({ ok: true, url: 'https://api.example.com/users//x' });
  });

  it('un valor percent-encoded no se decodifica dos veces', () => {
    expect(build('https://api.example.com/{{v}}', { v: '%2e%2e' })).toEqual({ ok: true, url: 'https://api.example.com/%252e%252e' });
  });
});

describe('Esquemas y formas no permitidos', () => {
  it.each([
    'ftp://api.example.com/',
    'api.example.com/x',
    'https://user:pass@api.example.com/',
    'https://user@api.example.com/',
    'https://api.example.com/a#b',
    'https://api.example.com/a\\b',
    'https://api.example.com/a b',
    'https://api.example.com/a\u200bb',
    'https://api.example.com/a\u00adb',
    'https://api.example.com/a\tb',
    'https://api.example.com/a\nb',
    'https://api.example.com/a\u0000b',
    'https://api.example.com/a\ud800',
    'https://api.example.com/a\udc00b',
    'https://exa%41mple.com/',
    'https://api%2eexample.com/',
    'https://exa%C2%ADmple.com/',
    'https://exa%E2%80%8Bmple.com/',
    '//api.example.com/',
    'https:/api.example.com/',
    'javascript:alert(1)',
    'httpx://api.example.com/',
    '',
  ])('%j es inválida', (url) => {
    expect(valid(url)).toBeUndefined();
  });

  it('el porcentaje fuera del host se conserva', () => {
    expect(valid('https://api.example.com/a%20b?q=%C3%B1')).toBe('https://api.example.com/a%20b?q=%C3%B1');
  });

  it.each(['https:///exa%C2%ADmple.com', 'https:////exa%C2%ADmple.com', 'http:///api%2eexample.com'])(
    'el % en el host tras barras iniciales (%j) se rechaza',
    (url) => expect(valid(url)).toBeUndefined(),
  );
});

describe('Sustituto suelto en el texto de la URL', () => {
  it('literal en el flujo', () => {
    expect(build('https://api.example.com/a\ud800').ok).toBe(false);
  });
});

describe('Segmentos de punto', () => {
  it.each([
    'https://api.example.com/users/../admin',
    'https://api.example.com/users/%2E%2e/admin',
    'https://api.example.com/users/.%2E/admin',
    'https://api.example.com/users/%2e./admin',
    'https://api.example.com/users/%2e/x',
    'https://api.example.com/users/./x',
    'https://api.example.com/..',
    'https://api.example.com/.',
    'https://api.example.com/a/%2e%2E',
    'https://api.example.com/a/%2E%2E/',
    'https://api.example.com/%2e',
  ])('%j es inválida', (url) => {
    expect(valid(url)).toBeUndefined();
  });

  it('el valor «..» insertado se codifica pero sigue siendo un segmento de punto', () => {
    expect(build('https://api.example.com/users/{{id}}', { id: '..' }).ok).toBe(false);
    expect(build('https://api.example.com/users/{{id}}', { id: '.' }).ok).toBe(false);
  });

  it.each([
    'https://api.example.com/u/..a',
    'https://api.example.com/u/...',
    'https://api.example.com/u/%252e%252e',
    'https://api.example.com/u/a..',
    'https://api.example.com/u/.a',
    'https://api.example.com/u?x=../a',
    'https://api.example.com/u?x=%2e%2e',
  ])('%j no tiene segmentos de punto y se entrega igual', (url) => {
    expect(valid(url)).toBe(url);
  });
});

describe('URLs válidas y su serialización', () => {
  it.each([
    ['HTTPS://API.Example.com:8443/v1/leads?x=1', 'https://api.example.com:8443/v1/leads?x=1'],
    ['https://exámple.com/a', 'https://xn--exmple-qta.com/a'],
    ['https://api.example.com/búsqueda', 'https://api.example.com/b%C3%BAsqueda'],
    ['https://api.example.com/u?x=../a', 'https://api.example.com/u?x=../a'],
    ['https://api.example.com', 'https://api.example.com/'],
    ['http://api.example.com:80/x', 'http://api.example.com/x'],
    ['https://api.example.com:443/x', 'https://api.example.com/x'],
    ['https://ａpi.example.com/', 'https://api.example.com/'],
    ['https://api。example.com/', 'https://api.example.com/'],
  ])('%j → %j', (url, href) => {
    expect(valid(url)).toBe(href);
  });
});

describe('Destinos internos', () => {
  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://１２７．０．０．１/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[2001:db8::1]:8080/',
    'http://localhost:8080/',
    'http://api.localhost/',
    'http://LOCALHOST/',
    'http://localhost./',
    'http://a.b.localhost/x',
    'http://169.254.169.254/latest/meta-data',
    'http://intranet/',
    'http://0/',
    'http://127.1/',
    'http://0177.0.0.1/',
    'http://0x7f000001/',
    'http://12345/',
    'http://1.5/',
    'http://600123456/',
    'http://10.0.0.5/',
    'https://api.example.com./',
    'https://a.b/',
    'https://api.example.123/',
  ])('%j es inválida', (url) => {
    expect(valid(url)).toBeUndefined();
  });

  it('el host con una barra ancha (no ASCII) no se admite', () => {
    expect(valid('http://a.com／b/')).toBeUndefined();
  });

  it('localhost como parte de otro nombre sí es un dominio', () => {
    expect(valid('https://localhost.example.com/')).toBe('https://localhost.example.com/');
    expect(valid('https://mylocalhost.com/')).toBe('https://mylocalhost.com/');
  });
});

describe('Longitud de la URL', () => {
  const prefix = 'https://api.example.com/';

  it('Longitud máxima de la URL', () => {
    expect(valid(prefix + 'a'.repeat(MAX_URL_LENGTH - prefix.length))).toHaveLength(MAX_URL_LENGTH);
    expect(valid(prefix + 'a'.repeat(MAX_URL_LENGTH - prefix.length + 1))).toBeUndefined();
    expect(build(prefix + 'a'.repeat(MAX_URL_LENGTH - prefix.length)).ok).toBe(true);
    expect(build(prefix + 'a'.repeat(MAX_URL_LENGTH - prefix.length + 1)).ok).toBe(false);
  });

  it('Longitud antes de serializar', () => {
    const with443 = 'https://api.example.com:443/';
    const ok = build(with443 + 'a'.repeat(8164));
    expect(with443.length + 8164).toBe(8192);
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok && ok.url).toHaveLength(8188);
    expect(build(with443 + 'a'.repeat(8165)).ok).toBe(false);
  });

  it('Valor que crece al codificarse', () => {
    const template = 'https://api.example.com/?q={{v}}';
    const first = build(template, { v: '中'.repeat(907) });
    expect(first.ok && first.url).toHaveLength(8190);
    expect(build(template, { v: '中'.repeat(908) }).ok).toBe(false);
  });

  it('la longitud serializada también se comprueba (el puerto con ceros encoge, lo no ASCII crece)', () => {
    // 8192 unidades escritas que serializan en más: cada ñ → %C3%B1
    expect(valid('https://api.example.com/' + 'ñ'.repeat(1400))).toBeUndefined();
  });
});

describe('Serialización idempotente', () => {
  it('toda URL aceptada cumple new URL(href).href === href', () => {
    const accepted = [
      'HTTPS://API.Example.com:8443/v1/leads?x=1',
      'https://exámple.com/a',
      'https://api.example.com/búsqueda',
      'http://api.example.com:80/x',
      'https://api.example.com/a%20b?q=%C3%B1',
      'https://api.example.com/\u{1F600}?x=中',
      'https://api.example.com/a/./b',
    ]
      .map(valid)
      .filter((href): href is string => href !== undefined);
    expect(accepted.length).toBeGreaterThanOrEqual(6);
    for (const href of accepted) expect(new URL(href).href).toBe(href);
  });
});
