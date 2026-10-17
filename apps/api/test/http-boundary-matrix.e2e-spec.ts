import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { hola } from './helpers/examples.js';
import { wireRequest, wireText, type WireResponse } from './helpers/wire.js';

/**
 * Matriz de formas de `Host` y `Origin` que una persona o una página maliciosa puede mandar a una API sin
 * autenticación que solo atiende a la máquina local. Las peticiones se escriben en bruto en un socket: ni
 * `supertest` ni `http.request` permiten un `Host` vacío, repetido o ausente, ni HTTP/1.0.
 */
describe('frontera HTTP: matriz de Host, Origin y peticiones de navegador (e2e)', () => {
  let testApp: TestApp;
  let prisma: PrismaClient;
  let api: ApiClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = createTestPrisma();
    api = client(testApp.server);
  });

  afterAll(async () => {
    await testApp.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const accessControl = (response: WireResponse) => response.headers.filter((line) => /^access-control-/i.test(line));
  const JSON_TYPE = 'Content-Type: application/json';

  /** Una petición con las cabeceras exactas que se indican (no se añade `Host`). */
  const send = (method: string, path: string, headers: string[], body?: string, version?: string) =>
    wireRequest(testApp.port, wireText(method, path, headers, body, version));

  const expectForbidden = (response: WireResponse, error: 'forbidden_host' | 'forbidden_origin') => {
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ message: expect.any(String), error });
    expect(Object.keys(response.json)).toEqual(['message', 'error']);
    expect(accessControl(response)).toEqual([]);
  };

  describe('Host', () => {
    it.each([
      '',
      '   ',
      'localhost:',
      'localhost:abc',
      'localhost:123456',
      '[::1',
      '::1',
      '[::1]x',
      '[0:0:0:0:0:0:0:1]',
      '[::ffff:127.0.0.1]:3001',
      '127.0.0.2',
      '127.0.0.2:3001',
      '127.1',
      '0x7f.0.0.1',
      '2130706433',
      'localhost.:3001',
      'user@localhost',
      'localhost@evil.example',
      'localhost:3001@evil.example',
      'localhost/',
      'localhost,evil.example',
      'evil.example,localhost',
      'localhost evil.example',
    ])('rechaza el Host %j y no hace nada más', async (host) => {
      const create = await send('POST', '/flows', [`Host: ${host}`, JSON_TYPE], JSON.stringify(hola()));
      expectForbidden(create, 'forbidden_host');
      await api.get('hola').expect(404);
      expectForbidden(await send('GET', '/flows', [`Host: ${host}`]), 'forbidden_host');
    });

    it.each(['localhost', 'LOCALHOST', 'LocalHost:3001', '127.0.0.1', '127.0.0.1:3001', '[::1]', '[::1]:3001', '  localhost:3001  '])(
      'admite el Host %j',
      async (host) => {
        const res = await send('GET', '/flows', [`Host: ${host}`]);
        expect(res.status).toBe(200);
        expect(accessControl(res)).toEqual([]);
      },
    );

    it('HTTP/1.0 sin Host (que Node sí deja pasar) responde 403 forbidden_host', async () => {
      expectForbidden(await send('GET', '/flows', [], undefined, '1.0'), 'forbidden_host');
      expectForbidden(await send('POST', '/flows', [JSON_TYPE], JSON.stringify(hola()), '1.0'), 'forbidden_host');
      await api.get('hola').expect(404);
    });

    it('HTTP/1.0 con un Host ajeno responde 403 y con uno local 200', async () => {
      expectForbidden(await send('GET', '/flows', ['Host: evil.example'], undefined, '1.0'), 'forbidden_host');
      expect((await send('GET', '/flows', ['Host: localhost'], undefined, '1.0')).status).toBe(200);
    });

    it('un Host repetido con el ajeno primero no llega a la API', async () => {
      const res = await send('POST', '/flows', ['Host: evil.example', 'Host: localhost', JSON_TYPE], JSON.stringify(hola()));
      // Node se queda con el primero (403) o rechaza la petición él mismo (400): lo que no puede pasar es un 2xx.
      expect([400, 403]).toContain(res.status);
      await api.get('hola').expect(404);
    });

    it('una URL absoluta local en la línea de petición no salva a un Host ajeno', async () => {
      const res = await wireRequest(testApp.port, 'GET http://localhost/flows HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n');
      expectForbidden(res, 'forbidden_host');
    });

    it('X-Forwarded-Host y Forwarded no sustituyen al Host', async () => {
      expectForbidden(await send('GET', '/flows', ['Host: evil.example', 'X-Forwarded-Host: localhost', 'Forwarded: host=localhost']), 'forbidden_host');
    });

    it('el Host se comprueba en cada petición de una conexión persistente', async () => {
      const wire = 'GET /flows?limit=1 HTTP/1.1\r\nHost: localhost\r\n\r\nGET /flows?limit=1 HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n';
      const res = await wireRequest(testApp.port, wire);
      expect(res.status).toBe(200);
      expect(res.text).toContain('forbidden_host');
    });

    it('un Host ajeno gana al Origin: el orden es Host y después Origin', async () => {
      expectForbidden(await send('GET', '/flows', ['Host: evil.example', 'Origin: https://evil.example']), 'forbidden_host');
      expectForbidden(await send('GET', '/flows', ['Host: localhost', 'Origin: https://evil.example']), 'forbidden_origin');
    });
  });

  describe('Origin y peticiones de navegador', () => {
    it.each([
      ['repetido', ['Origin: https://a.example', 'Origin: https://b.example']],
      ['solo espacios', ['Origin:    ']],
      ['vacío', ['Origin:']],
      ['null', ['Origin: null']],
      ['en minúsculas', ['origin: http://localhost:3000']],
      ['en mayúsculas', ['ORIGIN: http://127.0.0.1:3001']],
      ['un origen local', ['Origin: http://localhost:3001']],
    ])('rechaza un Origin %s', async (_name, headers) => {
      expectForbidden(await send('GET', '/flows', ['Host: localhost', ...headers]), 'forbidden_origin');
    });

    it('rechaza el Origin en las cuatro escrituras y no cambia nada', async () => {
      await api.create(hola()).expect(201);
      const headers = ['Host: localhost', 'Origin: https://evil.example'];
      expectForbidden(await send('POST', '/flows/hola/versions', headers), 'forbidden_origin');
      expectForbidden(await send('PUT', '/flows/hola', [...headers, JSON_TYPE, 'If-Match: *'], JSON.stringify({ ...hola(), name: 'Pisado' })), 'forbidden_origin');
      expectForbidden(await send('DELETE', '/flows/hola', headers), 'forbidden_origin');
      expectForbidden(await send('POST', '/flows', [...headers, JSON_TYPE], JSON.stringify({ ...hola(), id: 'otro' })), 'forbidden_origin');

      const draft = (await api.get('hola').expect(200)).body;
      expect(draft.name).toBe('Hola');
      expect(draft.revision).toBe(1);
      expect((await api.versions('hola').expect(200)).body.total).toBe(0);
      await api.get('otro').expect(404);
    });

    it.each(['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])(
      'una petición «simple» de navegador con %s y Origin es 403 y sin él, 415: nunca se guarda',
      async (type) => {
        const withOrigin = await send('POST', '/flows', ['Host: localhost', 'Origin: https://evil.example', `Content-Type: ${type}`], JSON.stringify(hola()));
        expectForbidden(withOrigin, 'forbidden_origin');
        const without = await send('POST', '/flows', ['Host: localhost', `Content-Type: ${type}`], JSON.stringify(hola()));
        expect(without.status).toBe(415);
        expect(without.json.error).toBe('unsupported_media_type');
        await api.get('hola').expect(404);
      },
    );

    it('OPTIONS, HEAD, GET y los errores nunca llevan cabeceras Access-Control-*', async () => {
      const responses = [
        await send('OPTIONS', '/flows', ['Host: localhost']),
        await send('OPTIONS', '/flows/hola', ['Host: localhost', 'Access-Control-Request-Method: PUT']),
        await send('OPTIONS', '*', ['Host: localhost']),
        await send('HEAD', '/flows', ['Host: localhost']),
        await send('GET', '/flows', ['Host: localhost']),
        await send('GET', '/nada', ['Host: localhost']),
        await send('GET', '/flows/%FF', ['Host: localhost']),
      ];
      for (const response of responses) expect(accessControl(response)).toEqual([]);
    });

    it('las cabeceras Referer y Sec-Fetch-* no abren ni cierran nada: manda el Origin', async () => {
      const res = await send('GET', '/flows', ['Host: localhost', 'Referer: https://evil.example/', 'Sec-Fetch-Site: cross-site', 'Sec-Fetch-Mode: no-cors']);
      expect(res.status).toBe(200);
      expect(accessControl(res)).toEqual([]);
    });
  });
});
