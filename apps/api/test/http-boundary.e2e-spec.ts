import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app.js';
import { hola } from './helpers/examples.js';
import { rawRequest } from './helpers/raw.js';

const MIB = 1_048_576;

describe('frontera HTTP', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
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
});
