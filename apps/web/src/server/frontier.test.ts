import { describe, expect, it } from 'vitest';
import { checkFrontier, securityHeaders } from '@/server/frontier';

const ID = '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90';

function run(method: string, pathname: string, headers: Record<string, string>) {
  return checkFrontier({ method, pathname, headers: new Headers(headers) });
}

describe('frontera: Host', () => {
  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST:3000'])('admite GET con Host %s', (host) => {
    expect(run('GET', '/', { host }).allowed).toBe(true);
  });

  it.each(['localhost.evil.example:3000', '127.0.0.1.nip.io:3000', 'localhost.:3000', 'evil.example:3000', ''])('rechaza Host %j con 403 sin cuerpo', (host) => {
    const decision = run('GET', '/', { host });
    expect(decision).toMatchObject({ allowed: false, status: 403, body: null });
  });

  it('rechaza un Host ausente', () => {
    expect(checkFrontier({ method: 'GET', pathname: '/', headers: new Headers() })).toMatchObject({ allowed: false, status: 403, body: null });
  });

  it('Host: evil.example:3000 con X-Forwarded-Host: localhost:3000 es 403 (solo cuenta el host en bruto)', () => {
    expect(run('GET', '/', { host: 'evil.example:3000', 'x-forwarded-host': 'localhost:3000' })).toMatchObject({ allowed: false, status: 403 });
    expect(run('GET', '/', { host: 'evil.example:3000', 'x-forwarded-host': 'localhost:3000', 'x-forwarded-for': '127.0.0.1', forwarded: 'host=localhost' })).toMatchObject({ allowed: false, status: 403 });
  });

  it('un Host local con un X-Forwarded-Host ajeno sigue siendo local (no se lee)', () => {
    expect(run('GET', '/', { host: 'localhost:3000', 'x-forwarded-host': 'evil.example' }).allowed).toBe(true);
  });

  it('una operación con Host ajeno es 403 aunque el Origin coincida con ese Host', () => {
    expect(run('POST', '/api/conversations', { host: 'evil.example:3000', origin: 'http://evil.example:3000' })).toMatchObject({ allowed: false, status: 403, body: null });
  });
});

describe('frontera: Origin', () => {
  const host = 'localhost:3000';

  it.each([
    ['POST', '/api/conversations', 'https://evil.example'],
    ['POST', '/api/conversations', 'null'],
    ['POST', '/api/conversations', 'http://127.0.0.1:3000'],
    ['POST', '/api/conversations', 'https://localhost:3000'],
    ['POST', '/api/conversations', 'http://localhost:3001'],
    ['POST', '/api/conversations', ''],
    ['DELETE', `/api/conversations/${ID}`, 'http://evil.example'],
    ['PUT', '/api/x', 'http://evil.example'],
    ['OPTIONS', '/api/conversations', 'http://evil.example'],
  ])('%s %s con Origin %j es 403 sin cuerpo', (method, pathname, origin) => {
    expect(run(method, pathname, { host, origin })).toMatchObject({ allowed: false, status: 403, body: null });
  });

  it.each(['POST', 'DELETE', 'PUT', 'PATCH'])('un %s sin Origin es 403', (method) => {
    expect(run(method, '/api/conversations', { host })).toMatchObject({ allowed: false, status: 403, body: null });
  });

  it('con el Origin propio, POST y DELETE pasan', () => {
    expect(run('POST', '/api/conversations', { host, origin: 'http://localhost:3000' }).allowed).toBe(true);
    expect(run('DELETE', `/api/conversations/${ID}`, { host, origin: 'http://localhost:3000' }).allowed).toBe(true);
  });

  it('el Origin se compara con el Host real: 127.0.0.1:3000 con su propio Origin pasa, y LOCALHOST se normaliza', () => {
    expect(run('POST', '/api/conversations', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }).allowed).toBe(true);
    expect(run('POST', '/api/conversations', { host: '[::1]:3000', origin: 'http://[::1]:3000' }).allowed).toBe(true);
    expect(run('POST', '/api/conversations', { host: 'LOCALHOST:3000', origin: 'http://localhost:3000' }).allowed).toBe(true);
  });

  it('http://127.0.0.1:3000 con Host localhost:3000 es 403', () => {
    expect(run('POST', '/api/conversations', { host, origin: 'http://127.0.0.1:3000' })).toMatchObject({ allowed: false, status: 403 });
  });

  it('GET y HEAD no exigen Origin', () => {
    expect(run('GET', '/api/conversations', { host }).allowed).toBe(true);
    expect(run('HEAD', '/', { host }).allowed).toBe(true);
    expect(run('get', '/', { host }).allowed).toBe(true);
  });
});

describe('frontera: ruta de conversación', () => {
  const host = 'localhost:3000';

  it('un UUID en minúsculas pasa, con o sin subruta', () => {
    expect(run('GET', `/api/conversations/${ID}`, { host }).allowed).toBe(true);
    expect(run('GET', `/api/conversations/${ID}/transcript`, { host }).allowed).toBe(true);
    expect(run('GET', '/api/conversations', { host }).allowed).toBe(true);
  });

  it.each([
    '..%2F..%2Fflows%2Fhola',
    '..%2f..%2fflows%2fhola',
    '00000000-0000-4000-8000-00000000000A',
    '%',
    '%E0%A4%A',
    '',
    'no-es-un-uuid',
    `${ID}%2Fx`,
    '%34f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90x',
  ])('%j es 404 conversation_not_found', (segment) => {
    const decision = run('GET', `/api/conversations/${segment}/inputs`, { host });
    expect(decision).toMatchObject({ allowed: false, status: 404, body: '{"error":"conversation_not_found"}' });
    expect(decision.headers['Content-Type']).toContain('application/json');
  });

  it('un id con codificación porcentual que decodifica a un UUID en minúsculas pasa', () => {
    expect(run('GET', `/api/conversations/${ID.replace('4f', '%34f')}`, { host }).allowed).toBe(true);
  });

  it('no mira rutas que no son de conversaciones', () => {
    expect(run('GET', '/api/flows/x', { host }).allowed).toBe(true);
    expect(run('GET', '/api/conversationsX/..', { host }).allowed).toBe(true);
  });
});

describe('frontera: cabeceras de respuesta', () => {
  const required = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
  };

  it('toda respuesta las lleva, también los 403 y los 404', () => {
    const decisions = [
      run('GET', '/', { host: 'localhost:3000' }),
      run('GET', '/', { host: 'evil.example' }),
      run('POST', '/api/conversations', { host: 'localhost:3000' }),
      run('GET', '/api/conversations/x', { host: 'localhost:3000' }),
    ];
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, false, false, false]);
    for (const decision of decisions) expect(decision.headers).toMatchObject(required);
  });

  it('nunca lleva Access-Control-Allow-*', () => {
    for (const decision of [run('GET', '/', { host: 'localhost:3000' }), run('POST', '/', { host: 'localhost:3000', origin: 'https://evil.example' })]) {
      expect(Object.keys(decision.headers).filter((name) => name.toLowerCase().startsWith('access-control-'))).toEqual([]);
    }
  });

  it('/_next/static/ no lleva no-store pero sí el resto', () => {
    const headers = securityHeaders('/_next/static/chunks/a.js');
    expect(headers['Cache-Control']).toBeUndefined();
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(run('GET', '/_next/static/chunks/a.js', { host: 'localhost:3000' }).headers['Cache-Control']).toBeUndefined();
    expect(securityHeaders('/_next/data/x')['Cache-Control']).toBe('no-store');
  });
});
