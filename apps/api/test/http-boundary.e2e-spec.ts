import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { hola } from './helpers/examples.js';
import { rawRequest } from './helpers/raw.js';

const MIB = 1_048_576;

describe('frontera HTTP', () => {
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

  const accessControl = (headers: Record<string, unknown>) => Object.keys(headers).filter((name) => name.startsWith('access-control-allow-'));

  describe('Host local', () => {
    it('rechaza un Host ajeno antes de todo lo demás, también en una ruta que existe', async () => {
      const res = await request(testApp.server).post('/flows/validate').set('Host', 'evil.example:3001').send(hola());
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: expect.any(String), error: 'forbidden_host' });
    });

    it.each(['localhost.evil.example', '127.0.0.1.nip.io', '0.0.0.0:3001', '[::ffff:127.0.0.1]', 'localhost.'])(
      'rechaza el Host %s',
      async (host) => {
        const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows/validate', headers: { host, 'content-type': 'application/json' }, body: '{}' });
        expect(res.status).toBe(403);
        expect(res.json.error).toBe('forbidden_host');
      },
    );

    it.each(['localhost:3001', 'LOCALHOST:3001', '127.0.0.1:3001', '[::1]:3001'])('admite el Host %s', async (host) => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows/validate', headers: { host, 'content-type': 'application/json' }, body: JSON.stringify(hola()) });
      expect(res.status).toBe(200);
    });
  });

  describe('Sin acceso desde navegadores', () => {
    it('Petición previa de CORS', async () => {
      const res = await request(testApp.server)
        .options('/flows')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden_origin');
      expect(accessControl(res.headers)).toEqual([]);
    });

    it.each(['https://evil.example', 'http://localhost:3000', 'null', ''])('rechaza cualquier Origin: %j', async (origin) => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows/validate', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(hola()) });
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ message: expect.any(String), error: 'forbidden_origin' });
      expect(accessControl(res.headers)).toEqual([]);
    });
  });

  describe('Forma de los errores', () => {
    it('Ruta o método desconocidos', async () => {
      const responses = [
        await request(testApp.server).get('/nada'),
        await request(testApp.server).patch('/flows/hola'),
        await rawRequest(testApp.port, { path: '/flows/%FF' }),
      ];
      for (const res of responses) {
        expect(res.status).toBe(404);
        const body = 'json' in res ? res.json : (res as { body: unknown }).body;
        expect(body).toEqual({ message: expect.any(String), error: 'not_found' });
        expect(Object.keys(body)).toEqual(['message', 'error']);
      }
    });

    it('el mensaje de una ruta con % mal formado no repite la ruta', async () => {
      const res = await rawRequest(testApp.port, { path: '/flows/%FF' });
      expect(res.text).not.toContain('%FF');
    });
  });

  describe('Tipo de contenido del cuerpo', () => {
    it('Cuerpo comprimido', async () => {
      const res = await request(testApp.server)
        .post('/flows/validate')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send(gzipSync(JSON.stringify(hola())));
      expect(res.status).toBe(415);
      expect(res.body.error).toBe('unsupported_media_type');
    });

    it('un cuerpo comprimido de más de 1 MiB responde 413 y no 415', async () => {
      const compressed = gzipSync(randomBytes(MIB + 4096));
      expect(compressed.length).toBeGreaterThan(MIB);
      const res = await request(testApp.server)
        .post('/flows/validate')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send(compressed);
      expect(res.status).toBe(413);
      expect(res.body.error).toBe('payload_too_large');
    });

    it.each([
      ['text/plain', 'unsupported_media_type'],
      ['application/json; charset=latin1', 'unsupported_media_type'],
      ['application/vnd.api+json', 'unsupported_media_type'],
    ])('con Content-Type %s responde 415', async (contentType, error) => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows/validate', headers: { 'content-type': contentType }, body: JSON.stringify(hola()) });
      expect(res.status).toBe(415);
      expect(res.json.error).toBe(error);
    });

    it('sin Content-Type pero con cuerpo responde 415', async () => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows/validate', body: JSON.stringify(hola()) });
      expect(res.status).toBe(415);
    });

    it('admite charset=utf-8 y Content-Encoding: identity', async () => {
      const res = await rawRequest(testApp.port, {
        method: 'POST',
        path: '/flows/validate',
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'identity' },
        body: JSON.stringify(hola()),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('Tamaño máximo del cuerpo', () => {
    it('También al validar', async () => {
      const res = await rawRequest(testApp.port, {
        method: 'POST',
        path: '/flows/validate',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(hola()).padEnd(MIB + 1),
      });
      expect(res.status).toBe(413);
      expect(res.json).toEqual({ message: expect.any(String), error: 'payload_too_large' });
    });

    it('un cuerpo de exactamente 1 MiB se acepta', async () => {
      const res = await rawRequest(testApp.port, {
        method: 'POST',
        path: '/flows/validate',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(hola()).padEnd(MIB),
      });
      expect(res.status).toBe(200);
      expect(res.json.valid).toBe(true);
    });
  });

  describe('Cuerpo JSON', () => {
    const post = (body: string | Uint8Array) =>
      rawRequest(testApp.port, { method: 'POST', path: '/flows/validate', headers: { 'content-type': 'application/json' }, body });

    it('Cuerpo vacío al validar', async () => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows/validate', headers: { 'content-type': 'application/json', 'content-length': '0' } });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('invalid_json');
    });

    it('sin cuerpo ni Content-Type al validar responde invalid_json', async () => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows/validate' });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('invalid_json');
    });

    it('un byte que no es UTF-8 responde invalid_json', async () => {
      const res = await post(Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('invalid_json');
    });

    it('un BOM al principio responde invalid_json', async () => {
      const res = await post(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(hola()))]));
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('invalid_json');
    });

    it('un cuerpo roto en cualquier endpoint responde invalid_json', async () => {
      const res = await rawRequest(testApp.port, { method: 'GET', path: '/flows/validate', headers: { 'content-type': 'application/json' }, body: '{"x":' });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('invalid_json');
    });

    it.each(['[]', '"hola"', '1', 'true', 'null'])('el JSON %s es un flujo inválido, no un error de la petición', async (text) => {
      const res = await post(text);
      expect(res.status).toBe(200);
      expect(res.json.valid).toBe(false);
      expect(res.json.issues[0]).toMatchObject({ layer: 'shape', path: '' });
    });
  });

  describe('Sin autenticación en v0', () => {
    it('la cabecera Authorization se ignora al validar', async () => {
      const without = await request(testApp.server).post('/flows/validate').send(hola());
      const withAuth = await request(testApp.server).post('/flows/validate').set('Authorization', 'Bearer cualquiera').send(hola());
      expect(withAuth.status).toBe(200);
      expect(withAuth.body).toEqual(without.body);
    });
  });
  describe('con el CRUD', () => {
    const holaText = () => JSON.stringify(hola());
    const flowsCount = () => prisma.flow.count();

    it('Host ajeno', async () => {
      const res = await api.create(hola()).set('Host', 'evil.example:3001');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: expect.any(String), error: 'forbidden_host' });
      await api.get('hola').expect(404);
      expect(await flowsCount()).toBe(0);
    });

    it('Nombres locales admitidos', async () => {
      for (const host of ['localhost:3001', 'LOCALHOST:3001', '127.0.0.1:3001', '[::1]:3001']) {
        await api.list().set('Host', host).expect(200);
      }
    });

    it('Escritura desde otra web', async () => {
      const res = await api.create(hola()).set('Origin', 'https://evil.example');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden_origin');
      await api.get('hola').expect(404);
      expect(await flowsCount()).toBe(0);
    });

    it('Peticiones sin Origin', async () => {
      const res = await api.list().expect(200);
      expect(accessControl(res.headers)).toEqual([]);
    });

    it('Credenciales ignoradas', async () => {
      await api.create(hola()).expect(201);
      const plain = await api.get('hola').expect(200);
      const withAuth = await api.get('hola').set('Authorization', 'Bearer cualquiera').expect(200);
      expect(withAuth.body).toEqual(plain.body);
    });

    it('Flujo inexistente', async () => {
      const res = await api.get('no-existe').expect(404);
      expect(Object.keys(res.body).sort()).toEqual(['error', 'message']);
      expect(res.body.error).toBe('flow_not_found');
    });

    it('Texto plano', async () => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows', headers: { 'content-type': 'text/plain' }, body: holaText() });
      expect(res.status).toBe(415);
      expect(res.json.error).toBe('unsupported_media_type');
      await api.get('hola').expect(404);
      expect(await flowsCount()).toBe(0);
    });

    it('Charset explícito', async () => {
      const res = await rawRequest(testApp.port, {
        method: 'POST',
        path: '/flows',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: holaText(),
      });
      expect(res.status).toBe(201);
    });

    it('Justo en el límite y por encima', async () => {
      const post = (body: string) => rawRequest(testApp.port, { method: 'POST', path: '/flows', headers: { 'content-type': 'application/json' }, body });
      const exact = holaText().padEnd(MIB);
      expect(Buffer.byteLength(exact)).toBe(MIB);
      expect((await post(exact)).status).toBe(201);
      await api.remove('hola').expect(204);
      const over = await post(`${exact} `);
      expect(over.status).toBe(413);
      expect(over.json.error).toBe('payload_too_large');
      await api.get('hola').expect(404);
      // Solo existe el primero (borrado): el segundo no llegó a validarse ni a guardarse.
      expect(await flowsCount()).toBe(1);
      expect((await prisma.flow.findUnique({ where: { id: 'hola' } }))?.revision).toBe(1);
    });

    it('JSON roto', async () => {
      for (const send of [() => api.validate('{"id":'), () => api.create('{"id":')]) {
        const res = await send().expect(400);
        expect(res.body.error).toBe('invalid_json');
      }
      expect(await flowsCount()).toBe(0);
    });

    it('Cuerpo vacío', async () => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows', headers: { 'content-type': 'application/json', 'content-length': '0' } });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('invalid_json');
    });

    it('Publicar con un cuerpo roto', async () => {
      await api.create(hola()).expect(201);
      const res = await api.publish('hola').set('Content-Type', 'application/json').send('{"x":').expect(400);
      expect(res.body.error).toBe('invalid_json');
      const versions = await api.versions('hola').expect(200);
      expect(versions.body.total).toBe(0);
    });

    it('JSON que no es un objeto', async () => {
      const validated = await api.validate('[]').expect(200);
      expect(validated.body.valid).toBe(false);
      expect(validated.body.issues[0]).toMatchObject({ layer: 'shape', path: '' });
      const created = await api.create('"hola"').expect(400);
      expect(created.body.error).toBe('invalid_flow');
    });
  });
});
