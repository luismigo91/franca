import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

const ID = '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90';
const SECURITY = ['cache-control', 'referrer-policy', 'x-content-type-options', 'content-security-policy', 'x-frame-options'];

/** Una petición de Next con las cabeceras **en bruto** que se indican (el `Host` no se deriva de la URL). */
function request(method: string, path: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method, headers });
}

describe('proxy.ts: el pegamento entre Next y la frontera', () => {
  it('una petición local pasa y lleva todas las cabeceras de seguridad', () => {
    const response = proxy(request('GET', '/', { host: 'localhost:3000' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    for (const name of SECURITY) expect(response.headers.get(name), name).not.toBeNull();
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });

  it('un Host ajeno es un 403 sin cuerpo y con las cabeceras de seguridad (y no sigue a la ruta)', async () => {
    const response = proxy(request('GET', '/', { host: 'evil.example:3000' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(await response.text()).toBe('');
    for (const name of SECURITY) expect(response.headers.get(name), name).not.toBeNull();
  });

  it('el Host se lee en bruto: una URL local con Host ajeno es 403 y un X-Forwarded-Host local no lo salva', () => {
    expect(proxy(request('GET', '/', { host: 'evil.example', 'x-forwarded-host': 'localhost:3000' })).status).toBe(403);
    expect(proxy(request('GET', '/', { host: 'localhost:3000', 'x-forwarded-host': 'evil.example' })).status).toBe(200);
  });

  it('un POST sin el Origin propio es 403 y con él pasa', () => {
    expect(proxy(request('POST', '/api/conversations', { host: 'localhost:3000' })).status).toBe(403);
    expect(proxy(request('POST', '/api/conversations', { host: 'localhost:3000', origin: 'http://evil.example' })).status).toBe(403);
    expect(proxy(request('POST', '/api/conversations', { host: 'localhost:3000', origin: 'null' })).status).toBe(403);
    expect(proxy(request('POST', '/api/conversations', { host: 'localhost:3000', origin: 'http://localhost:3000' })).headers.get('x-middleware-next')).toBe('1');
  });

  it('un id de conversación que no es un UUID es un 404 JSON antes de enrutar', async () => {
    const response = proxy(request('DELETE', '/api/conversations/nope', { host: 'localhost:3000', origin: 'http://localhost:3000' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'conversation_not_found' });
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(proxy(request('GET', `/api/conversations/${ID}`, { host: 'localhost:3000' })).headers.get('x-middleware-next')).toBe('1');
  });

  it('un estático no lleva no-store pero sí el resto, y un 403 de estático también', () => {
    const allowed = proxy(request('GET', '/_next/static/chunks/a.js', { host: '127.0.0.1:3000' }));
    expect(allowed.headers.get('cache-control')).toBeNull();
    expect(allowed.headers.get('x-frame-options')).toBe('DENY');
    const denied = proxy(request('GET', '/_next/static/chunks/a.js', { host: 'evil.example' }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('x-frame-options')).toBe('DENY');
  });

  it('nunca añade Access-Control-Allow-*', () => {
    for (const response of [proxy(request('GET', '/', { host: 'localhost:3000' })), proxy(request('POST', '/api/conversations', { host: 'localhost:3000', origin: 'http://evil.example' }))]) {
      expect([...response.headers.keys()].filter((name) => name.startsWith('access-control-'))).toEqual([]);
    }
  });
});
