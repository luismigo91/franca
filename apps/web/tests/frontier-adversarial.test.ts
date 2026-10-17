import { describe, expect, it } from 'vitest';
import { isLocalHost } from '@/server/config/local-host.cjs';
import { checkFrontier } from '@/server/frontier';

// QA adversarial de la frontera (R2): variantes que un DNS rebinding o una herramienta de la máquina pueden mandar y que los
// tests de `frontier.test.ts` y `local-host.test.ts` no nombran.

const ID = '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90';
const post = (headers: Record<string, string>) => checkFrontier({ method: 'POST', pathname: '/api/conversations', headers: new Headers(headers) });

describe('frontera adversarial: Host', () => {
  it.each([
    '127.1',
    '127.1:3000',
    '0x7f.1',
    '0x7f000001',
    '2130706433',
    '127.0.0.1.',
    '127.0.0.1.:3000',
    '[::1].',
    '[::1]:3000.',
    '[0:0:0:0:0:0:0:1]',
    '[::ffff:127.0.0.1]',
    '::1',
    '::1:3000',
    'localhost:+80',
    'localhost:0x50',
    'localhost:３０００',
    'localhost\t',
    'localhost\u0000',
    'localhost:3000\r\nX: y',
    'localhost:3000, evil.example',
    'evil.example, localhost:3000',
    'localhost@evil.example',
    'localhost:3000@evil.example',
    'evil.example#localhost:3000',
    'evil.example/localhost',
    'ⓛocalhost',
    'localhost%2e',
    '%6cocalhost',
  ])('rechaza el Host %j', (host) => {
    expect(isLocalHost(host), host).toBe(false);
    expect(checkFrontier({ method: 'GET', pathname: '/', headers: { get: (name: string) => (name === 'host' ? host : null) } })).toMatchObject({ allowed: false, status: 403, body: null });
  });

  it('el Host con puerto fuera de rango pasa porque el puerto no es lo que protege (no hay nada que abusar)', () => {
    // Documenta el comportamiento actual: `[0-9]{1,5}` no comprueba ≤ 65535. Un puerto imposible nunca llega a Node.
    expect(isLocalHost('localhost:99999')).toBe(true);
  });
});

describe('frontera adversarial: Origin', () => {
  const host = '127.0.0.1:3000';

  it.each([
    'HTTP://127.0.0.1:3000',
    'http://127.0.0.1:3000/',
    'http://127.0.0.1:3000/path',
    'http://127.0.0.1',
    'http://127.0.0.1:03000',
    'http://127.0.0.1:3000.',
    'http://localhost:3000',
    'http://[::1]:3000',
    'https://127.0.0.1:3000',
    'http://127.0.0.1:3000,http://evil.example',
    'http://evil.example,http://127.0.0.1:3000',
    'http://127.0.0.1:3000@evil.example',
    'http://evil.example@127.0.0.1:3000',
    'file://',
    'null',
    '',
  ])('un POST con el Origin %j es 403 sin cuerpo', (origin) => {
    expect(post({ host, origin })).toMatchObject({ allowed: false, status: 403, body: null });
  });

  it('el Origin es una comparación exacta: ni siquiera cambia por mayúsculas en el esquema o el host', () => {
    // Un navegador serializa siempre en minúsculas, así que tolerar mayúsculas no ayuda a nadie y ensancha la regla (R2).
    expect(post({ host: 'LOCALHOST:3000', origin: 'http://localhost:3000' }).allowed).toBe(true);
    expect(post({ host: 'localhost:3000', origin: 'http://LOCALHOST:3000' }).allowed).toBe(false);
    expect(post({ host: 'localhost:3000', origin: 'HTTP://localhost:3000' }).allowed).toBe(false);
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND', 'FOO'])('el método %s sin Origin es 403, también con una ruta de conversación válida', (method) => {
    expect(checkFrontier({ method, pathname: `/api/conversations/${ID}`, headers: new Headers({ host }) })).toMatchObject({ allowed: false, status: 403, body: null });
  });

  it('la regla del 403 va antes que la del 404: un id inválido con Origin ajeno es 403, no 404', () => {
    expect(checkFrontier({ method: 'DELETE', pathname: '/api/conversations/nope', headers: new Headers({ host, origin: 'http://evil.example' }) })).toMatchObject({ status: 403, body: null });
  });
});

describe('frontera adversarial: id de conversación', () => {
  const headers = new Headers({ host: 'localhost:3000' });

  it.each(['%2e%2e', '%2E%2E%2Fflows', '..', '.', '%00', `${ID}%00`, `${ID}%20`, `%20${ID}`, `${ID.toUpperCase()}`, `{${ID}}`, `urn:uuid:${ID}`, `${ID.replaceAll('-', '')}`, `${ID}%0a`, `${ID}%e2%80%8b`])(
    'el segmento %j no pasa',
    (segment) => {
      expect(checkFrontier({ method: 'GET', pathname: `/api/conversations/${segment}`, headers })).toMatchObject({ allowed: false, status: 404, body: '{"error":"conversation_not_found"}' });
    },
  );
});
