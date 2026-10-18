import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { checkFrontier, securityHeaders } from '@/server/frontier';
import { isFlowId } from '@/server/ids';

function run(method: string, pathname: string, headers: Record<string, string>) {
  return checkFrontier({ method, pathname, headers: new Headers(headers) });
}

const HOST = 'localhost:3000';
const ORIGIN = { host: HOST, origin: `http://${HOST}` };

describe('frontera del editor: el segmento de /api/editor/flows/', () => {
  it.each([
    ['/api/editor/flows/..%2Fconversations', 'GET'],
    ['/api/editor/flows/..%2Fconversations/versions', 'POST'],
    ['/api/editor/flows/Hola', 'PUT'],
    ['/api/editor/flows/Hola/versions', 'POST'],
    ['/api/editor/flows/%', 'GET'],
    ['/api/editor/flows/%E0%A4%A', 'DELETE'],
    ['/api/editor/flows/a%2Fb', 'GET'],
    ['/api/editor/flows/', 'GET'],
    ['/api/editor/flows//versions', 'POST'],
    ['/api/editor/flows/1abc', 'GET'],
    ['/api/editor/flows/' + 'a'.repeat(65), 'GET'],
  ])('%s (%s) es 404 flow_not_found con las cabeceras de seguridad (skipFlowSegmentCheck)', (pathname, method) => {
    const decision = run(method, pathname, method === 'GET' ? { host: HOST } : ORIGIN);
    expect(decision).toMatchObject({ allowed: false, status: 404, body: '{"error":"flow_not_found"}' });
    expect(decision.allowed ? {} : decision.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    });
  });

  it.each([
    ['/api/editor/flows', 'GET'],
    ['/api/editor/flows', 'POST'],
    ['/api/editor/flows/hola', 'GET'],
    ['/api/editor/flows/hola', 'PUT'],
    ['/api/editor/flows/hola', 'DELETE'],
    ['/api/editor/flows/hola/versions', 'POST'],
    ['/api/editor/flows/h%6Fla', 'GET'],
    ['/api/editor/flows/a-b_1', 'GET'],
  ])('%s (%s) con un id válido o sin segmento pasa', (pathname, method) => {
    expect(run(method, pathname, method === 'GET' ? { host: HOST } : ORIGIN).allowed).toBe(true);
  });

  it('el id válido es el patrón del esquema', () => {
    expect(isFlowId('hola')).toBe(true);
    expect(isFlowId('Hola')).toBe(false);
    expect(isFlowId('../conversations')).toBe(false);
  });

  it('el Host se comprueba antes que el segmento: Host ajeno con un id inválido es 403 sin cuerpo', () => {
    expect(run('GET', '/api/editor/flows/Hola', { host: 'evil.example:3000' })).toMatchObject({ allowed: false, status: 403, body: null });
  });
});

describe('frontera del editor: Origin en las mutaciones nuevas', () => {
  const mutations: [string, string][] = [
    ['POST', '/api/editor/flows'],
    ['PUT', '/api/editor/flows/hola'],
    ['POST', '/api/editor/flows/hola/versions'],
    ['DELETE', '/api/editor/flows/hola'],
  ];

  it.each(mutations)('%s %s exige Origin igual a http://<Host>: sin Origin, null, otro host, otro puerto o https son 403 sin cuerpo', (method, pathname) => {
    for (const origin of [undefined, 'null', 'https://evil.example', 'http://127.0.0.1:3000', 'https://localhost:3000', 'http://localhost:3001', '']) {
      const headers: Record<string, string> = { host: HOST };
      if (origin !== undefined) headers.origin = origin;
      expect(run(method, pathname, headers), String(origin)).toMatchObject({ allowed: false, status: 403, body: null });
    }
    expect(run(method, pathname, { host: 'evil.example:3000', origin: 'http://evil.example:3000' })).toMatchObject({ allowed: false, status: 403, body: null });
    expect(run(method, pathname, ORIGIN).allowed).toBe(true);
  });

  it('un GET de la lista no pide Origin', () => {
    expect(run('GET', '/api/editor/flows', { host: HOST }).allowed).toBe(true);
  });
});

describe('CSP', () => {
  it('la CSP no restringe scripts: el validador del editor compila con Function', () => {
    const csp = securityHeaders('/flujos/hola')['Content-Security-Policy'];
    expect(csp).toBe("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src|default-src|unsafe-eval/);
    // El validador compila ajv con `Function` al importarse (D7): si esto lanzara, el editor no cargaría.
    expect(() => new Function('return 1')()).not.toThrow();
    expect(validateFlow({ id: 'x' }).valid).toBe(false);
  });
});
