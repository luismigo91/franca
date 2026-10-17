import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { leads } from './helpers/examples.js';

const MIB = 1_048_576;
const DEPTH_ISSUE = { layer: 'shape', path: '', message: 'el flujo supera la profundidad máxima de anidamiento (1000)' };

/** `captacion-leads` con `nodes` sustituido por objetos `{}` hasta casi 1 MiB de cuerpo. */
function megaOfEmptyNodes(): string {
  const flow = leads();
  flow.nodes = [];
  const prefix = JSON.stringify(flow).replace('"nodes":[]}', '"nodes":[');
  const count = Math.floor((MIB - Buffer.byteLength(prefix) - 2) / 3);
  return `${prefix}${Array.from({ length: count }, () => '{}').join(',')}]}`;
}

describe('tamaño, profundidad y coste (e2e)', () => {
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

  it('el cuerpo más profundo que cabe en 1 MiB (524 287 niveles) da 400 con el issue de profundidad, no 500', async () => {
    const levels = 524_287;
    const body = `${'['.repeat(levels)}${']'.repeat(levels)}`;
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MIB);
    const res = await api.create(body).expect(400);
    expect(res.body).toEqual({ message: expect.any(String), error: 'invalid_flow', issues: [DEPTH_ISSUE], warnings: [] });
    const validated = await api.validate(body).expect(200);
    expect(validated.body).toEqual({ valid: false, issues: [DEPTH_ISSUE], warnings: [] });
    expect(await prisma.flow.count()).toBe(0);
  });

  it('un cuerpo de ~1 MiB de 1e20 se guarda (×4,4 al volver a escribirlo) y GET devuelve el mismo texto', async () => {
    const flow = leads();
    flow.variables.push({ name: 'j', type: 'json', default: '__NUMEROS__' });
    const [before, after] = JSON.stringify(flow).split('"__NUMEROS__"') as [string, string];
    const count = Math.floor((MIB - Buffer.byteLength(before) - Buffer.byteLength(after) - 1) / 5);
    const text = `${before}[${Array.from({ length: count }, () => '1e20').join(',')}]${after}`;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MIB);
    expect(Buffer.byteLength(text)).toBeGreaterThan(MIB * 0.99);

    const created = await api.create(text).expect(201);
    const expanded = JSON.stringify(Array.from({ length: count }, () => 1e20));
    expect(expanded.length).toBeGreaterThan(4 * MIB);
    expect(created.text).toContain(expanded);
    const read = await api.get('captacion-leads').expect(200);
    expect(read.text).toContain(expanded);
    expect(Buffer.byteLength(read.text)).toBeLessThan(4.5 * MIB);
    expect(read.body.flow.variables.at(-1).default).toHaveLength(count);
  });

  it('un predicado anidado hasta el límite se guarda y uno de 5000 niveles es un flujo inválido, sin 500', async () => {
    const leaf = '{"variable":"segmento","op":"eq","value":"empresa"}';
    const original = JSON.stringify(leads()).replace(/("rules":\[\{"when":)\{[^}]*\}/, '$1__PREDICADO__');
    expect(original).toContain('__PREDICADO__');
    const nest = (levels: number, id: string) =>
      original
        .replace('__PREDICADO__', `${'{"all":['.repeat(levels)}${leaf}${']}'.repeat(levels)}`)
        .replace('"id":"captacion-leads"', `"id":"${id}"`);
    await api.create(nest(497, 'captacion-leads')).expect(201);
    const res = await api.create(nest(5000, 'otro')).expect(400);
    expect(res.body.issues).toEqual([DEPTH_ISSUE]);
  });

  it('Flujo inválido de un mega en POST /flows: 400 invalid_flow con 101 issues', async () => {
    const body = megaOfEmptyNodes();
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MIB);
    const started = performance.now();
    const res = await api.create(body).expect(400);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(res.body.error).toBe('invalid_flow');
    expect(res.body.issues).toHaveLength(101);
    expect(res.body.issues[100]).toMatchObject({ code: 'too_many_issues', layer: 'shape', path: '' });
    expect(Buffer.byteLength(res.text)).toBeLessThan(MIB);
  });
});
