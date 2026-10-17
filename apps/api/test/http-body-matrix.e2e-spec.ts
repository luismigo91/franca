import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { hola } from './helpers/examples.js';
import { rawRequest } from './helpers/raw.js';
import { wireRequest, type WireResponse } from './helpers/wire.js';

const MIB = 1_048_576;

/**
 * Matriz del cuerpo de la petición: tipo de contenido, bytes que no son JSON, codificación de transferencia y
 * compresión. Los límites se miden en bytes tal como llegan, no tal como se interpretan después.
 */
describe('cuerpo de la petición: tipo, bytes, troceado y compresión (e2e)', () => {
  let testApp: TestApp;
  let prisma: PrismaClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await testApp.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const holaText = (id = 'hola') => JSON.stringify({ ...hola(), id });
  const validate = (body: string | Uint8Array, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    rawRequest(testApp.port, { method: 'POST', path: '/flows/validate', headers: { host: 'localhost', ...headers }, body });
  const padTo = (text: string, bytes: number) => text + ' '.repeat(bytes - Buffer.byteLength(text));

  describe('Content-Type', () => {
    it.each([
      'application/json; charset=utf-8',
      'application/json;charset=UTF-8',
      'application/json; charset="utf-8"',
      'application/json ;charset=utf-8',
      'APPLICATION/JSON',
      'Application/Json; Charset=Utf-8',
    ])('se admite %j', async (type) => {
      expect((await validate(holaText(), { 'content-type': type })).status).toBe(200);
    });

    it.each([
      'application/json; charset=utf8',
      'application/json; charset=latin1',
      'application/json; charset=utf-16',
      'application/json; boundary=x',
      'application/json; charset=utf-8; foo=1',
      'application/json, text/plain',
      'application/jsonp',
      'application/json-patch+json',
      'application/vnd.api+json',
      'text/json',
      'text/plain',
      'text/plain;charset=UTF-8',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/*',
      '*/*',
      'json',
      '',
    ])('se rechaza %j con 415 y no se guarda nada', async (type) => {
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows', headers: { host: 'localhost', 'content-type': type }, body: holaText() });
      expect(res.status).toBe(415);
      expect(res.json).toEqual({ message: expect.any(String), error: 'unsupported_media_type' });
      expect(await prisma.flow.count()).toBe(0);
    });
  });

  describe('bytes que no son un flujo', () => {
    const bytes = (...parts: (string | number[])[]) => Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part) : Buffer.from(part))));

    it.each([
      ['un BOM delante', bytes([0xef, 0xbb, 0xbf], holaText())],
      ['UTF-8 inválido en una cadena', bytes('{"name":"', [0xff, 0xfe], '"}')],
      ['una secuencia UTF-8 sobrelarga', bytes('{"name":"', [0xc0, 0x80], '"}')],
      ['un sustituto codificado en UTF-8 (CESU)', bytes('{"name":"', [0xed, 0xa0, 0x80], '"}')],
      ['un NUL sin escapar dentro de una cadena', bytes('{"name":"a\u0000b"}')],
      ['un salto de línea sin escapar dentro de una cadena', bytes('{"name":"a\nb"}')],
      ['NaN', bytes('{"a":NaN}')],
      ['Infinity', bytes('{"a":Infinity}')],
      ['comentarios', bytes('{"a":1}//x')],
      ['dos valores seguidos', bytes('{"a":1}{"b":2}')],
      ['una coma final', bytes('{"a":1,}')],
      ['comillas simples', bytes("{'a':1}")],
      ['claves sin comillas', bytes('{a:1}')],
      ['solo espacios', bytes('   ')],
      ['solo un salto de línea', bytes('\n')],
      ['un millón de corchetes sin cerrar', Buffer.alloc(MIB, 0x5b)],
      ['un objeto sin cerrar', bytes(holaText().slice(0, -1))],
    ])('%s responde 400 invalid_json en el validador y al crear', async (_name, body) => {
      const validated = await validate(body);
      expect(validated.status).toBe(400);
      expect(validated.json).toEqual({ message: expect.any(String), error: 'invalid_json' });
      const created = await rawRequest(testApp.port, { method: 'POST', path: '/flows', headers: { host: 'localhost', 'content-type': 'application/json' }, body });
      expect(created.status).toBe(400);
      expect(created.json.error).toBe('invalid_json');
      expect(await prisma.flow.count()).toBe(0);
    });

    it('claves repetidas en el cuerpo se resuelven como JavaScript: gana la última', async () => {
      const text = holaText().replace('"name"', '"id":"zz","name"');
      const res = await rawRequest(testApp.port, { method: 'POST', path: '/flows', headers: { host: 'localhost', 'content-type': 'application/json' }, body: text });
      expect(res.status).toBe(201);
      expect(res.json.id).toBe('zz');
    });

    it('524 287 niveles balanceados son un flujo inválido por profundidad, no un error de la petición', async () => {
      const deep = Buffer.concat([Buffer.alloc(524_287, 0x5b), Buffer.alloc(524_287, 0x5d)]);
      const res = await validate(deep);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({
        valid: false,
        issues: [{ layer: 'shape', path: '', message: 'el flujo supera la profundidad máxima de anidamiento (1000)' }],
        warnings: [],
      });
    });
  });

  describe('Transfer-Encoding: chunked', () => {
    const chunked = (payload: Buffer, size = 65_536) => {
      const parts: Buffer[] = [];
      for (let offset = 0; offset < payload.length; offset += size) {
        const chunk = payload.subarray(offset, offset + size);
        parts.push(Buffer.from(`${chunk.length.toString(16)}\r\n`), chunk, Buffer.from('\r\n'));
      }
      parts.push(Buffer.from('0\r\n\r\n'));
      return Buffer.concat(parts);
    };
    const post = (extra: string[], payload: Buffer, path = '/flows'): Promise<WireResponse> =>
      wireRequest(
        testApp.port,
        Buffer.concat([
          Buffer.from(
            `POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n${extra.map((line) => `${line}\r\n`).join('')}Connection: close\r\n\r\n`,
          ),
          chunked(payload),
        ]),
      );

    it('un cuerpo troceado de exactamente 1 MiB se acepta y con un byte más responde 413 sin guardarlo', async () => {
      const ok = await post([], Buffer.from(padTo(holaText(), MIB)));
      expect(ok.status).toBe(201);
      await prisma.flow.deleteMany();
      const over = await post([], Buffer.from(padTo(holaText(), MIB + 1)));
      expect(over.status).toBe(413);
      expect(over.json).toEqual({ message: expect.any(String), error: 'payload_too_large' });
      expect(await prisma.flow.count()).toBe(0);
    });

    it('un cuerpo troceado de 50 MiB se corta con 413 sin leerlo entero', async () => {
      const started = performance.now();
      const res = await post([], Buffer.alloc(50 * MIB, 0x20));
      expect(res.status).toBe(413);
      expect(performance.now() - started).toBeLessThan(10_000);
    });

    it('un cuerpo troceado y comprimido: 415 si cabe y 413 si no cabe, y nunca se descomprime', async () => {
      const small = await post(['Content-Encoding: gzip'], gzipSync(holaText()));
      expect(small.status).toBe(415);
      const incompressible = Buffer.alloc(MIB + 10);
      for (let offset = 0; offset < incompressible.length; offset += 65_536) {
        crypto.getRandomValues(incompressible.subarray(offset, Math.min(offset + 65_536, incompressible.length)));
      }
      const big = await post(['Content-Encoding: gzip'], incompressible);
      expect(big.status).toBe(413);
    });
  });

  describe('Content-Encoding', () => {
    it.each(['gzip', 'x-gzip', 'deflate', 'br', 'zstd', 'compress', 'identity, gzip', 'gzip, identity', ''])('%j se rechaza con 415 y no se descomprime', async (encoding) => {
      const res = await validate(holaText(), { 'content-type': 'application/json', 'content-encoding': encoding });
      expect(res.status).toBe(415);
      expect(res.json.error).toBe('unsupported_media_type');
    });

    it.each(['identity', 'IDENTITY', ' identity '])('%j se admite', async (encoding) => {
      expect((await validate(holaText(), { 'content-type': 'application/json', 'content-encoding': encoding })).status).toBe(200);
    });

    it('una bomba gzip de 128 MiB descomprimidos responde 415 enseguida: la API no descomprime', async () => {
      const bomb = gzipSync(Buffer.alloc(128 * MIB, 0x20), { level: 9 });
      expect(bomb.length).toBeLessThan(MIB);
      const started = performance.now();
      const res = await validate(bomb, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      expect(res.status).toBe(415);
      expect(performance.now() - started).toBeLessThan(3000);
    });

    it('sin cuerpo, Content-Encoding no importa', async () => {
      const res = await rawRequest(testApp.port, { path: '/flows', headers: { host: 'localhost', 'content-encoding': 'gzip' } });
      expect(res.status).toBe(200);
    });
  });
});
