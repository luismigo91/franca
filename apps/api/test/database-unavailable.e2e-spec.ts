import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FlowsRepository } from '../src/flows/flows.repository.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { hola, leads } from './helpers/examples.js';
import { closedPort, SECRET_PASSWORD, startMuteServer, urlTo, type MuteServer } from './helpers/network.js';
import { captureOutput } from './helpers/output.js';

const UNAVAILABLE = { message: expect.any(String), error: 'database_unavailable' };
const LIMIT_MS = 10_000;

describe('base de datos no disponible y fallos internos (e2e)', () => {
  let testApp: TestApp | undefined;
  let mute: MuteServer | undefined;
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
  });

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
    await mute?.close();
    mute = undefined;
    await prisma.$disconnect();
  });

  it('Postgres parado', async () => {
    const output = captureOutput();
    const port = await closedPort();
    testApp = await createTestApp({ logger: output.logger, config: { databaseUrl: urlTo(port) } });
    const api = client(testApp.server);

    const list = await api.list().expect(503);
    const create = await api.create(hola()).expect(503);
    const validate = await api.validate(hola()).expect(200);
    expect(list.body).toEqual(UNAVAILABLE);
    expect(create.body).toEqual(UNAVAILABLE);
    expect(Object.keys(list.body)).toEqual(['message', 'error']);
    expect(validate.body.valid).toBe(true);

    // Ni la respuesta ni el registro llevan la contraseña, el host ni el puerto de la conexión.
    for (const text of [list.text, create.text, output.text()]) {
      expect(text).not.toContain(SECRET_PASSWORD);
      expect(text).not.toContain(`127.0.0.1:${port}`);
      expect(text).not.toContain(`${port}`);
    }
    expect(output.lines()).toContain('error GET /flows 503 database_unavailable Http');
  });

  it('Postgres mudo', async () => {
    const output = captureOutput();
    mute = await startMuteServer();
    testApp = await createTestApp({ logger: output.logger, config: { databaseUrl: urlTo(mute.port) } });
    const api = client(testApp.server);

    const timed = async (send: () => PromiseLike<{ status: number; body: unknown; text: string }>) => {
      const started = performance.now();
      const res = await send();
      return { res, ms: performance.now() - started };
    };
    const results = await Promise.all([
      timed(() => api.list()),
      timed(() => api.create(hola())),
      timed(() => api.update('hola', hola(), '*')),
    ]);
    for (const { res, ms } of results) {
      expect(res.status).toBe(503);
      expect(res.body).toEqual(UNAVAILABLE);
      expect(ms).toBeLessThan(LIMIT_MS);
      expect(res.text).not.toContain(SECRET_PASSWORD);
    }
    expect(output.text()).not.toContain(SECRET_PASSWORD);
    expect(output.text()).not.toContain(`${mute.port}`);
  });

  it('Bloqueo que no se suelta', async () => {
    const output = captureOutput();
    testApp = await createTestApp({ logger: output.logger });
    const api = client(testApp.server);
    await api.create(hola()).expect(201);

    // Otra conexión con la fila bloqueada y sin terminar.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const locked = new Promise<void>((resolve, reject) => {
      prisma
        .$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM flows WHERE id = 'hola' FOR UPDATE`;
            resolve();
            await held;
          },
          { timeout: 60_000 },
        )
        .catch(reject);
    });
    await locked;

    try {
      const started = performance.now();
      const res = await api.update('hola', { ...hola(), name: 'Otro' }, '*');
      const ms = performance.now() - started;
      expect(res.status).toBe(503);
      expect(res.body).toEqual(UNAVAILABLE);
      expect(ms).toBeLessThan(LIMIT_MS);
      expect(output.lines()).toContain('error PUT /flows/hola 503 database_unavailable Http');
    } finally {
      release();
    }
  });

  it('Base, usuario o conexión segura mal configurados', async () => {
    const base = new URL(process.env.DATABASE_URL ?? '');
    base.password = SECRET_PASSWORD;
    const variants = [
      { code: 'P1003', url: withChange(base, (url) => (url.pathname = '/no_existe_zz')) },
      { code: 'P1010', url: withChange(base, (url) => (url.username = 'nadie_zz')) },
      // El servidor de los tests no tiene TLS: `require` falla al abrir la conexión segura.
      { code: 'P1011', url: withChange(base, (url) => url.searchParams.set('sslmode', 'require')) },
    ];
    for (const { code, url } of variants) {
      const output = captureOutput();
      testApp = await createTestApp({ logger: output.logger, config: { databaseUrl: url } });
      const api = client(testApp.server);

      const list = await api.list();
      const create = await api.create(hola());
      const validate = await api.validate(hola());
      expect({ code, list: [list.status, list.body], create: [create.status, create.body] }).toEqual({
        code,
        list: [503, UNAVAILABLE],
        create: [503, UNAVAILABLE],
      });
      expect(validate.status).toBe(200);
      for (const text of [list.text, create.text, output.text()]) {
        expect(text).not.toContain(SECRET_PASSWORD);
        expect(text).not.toContain('no_existe_zz');
        expect(text).not.toContain('nadie_zz');
      }
      // El registro nombra el código de Prisma para que quien opera vea que es configuración.
      expect(output.lines()).toContain(`error GET /flows 503 database_unavailable ${code} Http`);
      await testApp.close();
      testApp = undefined;
      output.restore();
    }
  });

  it('Transacción caducada por el propio código', async () => {
    const output = captureOutput();
    class ExpiringRepository extends FlowsRepository {
      override async withLockedFlow<T>(): Promise<T> {
        return this.prisma.$transaction(
          async (tx) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return (await tx.$queryRaw`SELECT 1`) as T;
          },
          { timeout: 50 },
        );
      }
    }
    testApp = await createTestApp({
      logger: output.logger,
      configure: (builder) =>
        builder.overrideProvider(FlowsRepository).useFactory({ factory: (service: PrismaService) => new ExpiringRepository(service), inject: [PrismaService] }),
    });
    const api = client(testApp.server);

    const res = await api.remove('hola');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'error interno', error: 'internal_error' });
    expect(output.lines()).toContain('error DELETE /flows/hola 500 internal_error PrismaClientKnownRequestError P2028 Http');
  });

  it('Error interno', async () => {
    const output = captureOutput();
    class FailingRepository extends FlowsRepository {
      override async findActive(): Promise<never> {
        throw new Error('SELECT draft FROM flows WHERE id = $1 -- {"nodes":[{"text":"Te hago tres preguntas"}]} Bearer abc123');
      }
    }
    testApp = await createTestApp({
      logger: output.logger,
      configure: (builder) =>
        builder.overrideProvider(FlowsRepository).useFactory({ factory: (service: PrismaService) => new FailingRepository(service), inject: [PrismaService] }),
    });
    const api = client(testApp.server);

    const res = await api.get('hola');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'error interno', error: 'internal_error' });
    expect(Object.keys(res.body)).toEqual(['message', 'error']);
    for (const text of [res.text, output.text()]) {
      expect(text).not.toContain('SELECT');
      expect(text).not.toContain('Te hago tres preguntas');
      expect(text).not.toContain('abc123');
    }
    expect(output.lines()).toContain('error GET /flows/hola 500 internal_error Error Http');
  });

  it('un flujo con una credencial se rechaza sin tocar la base aunque esté parada (validación antes de la conexión)', async () => {
    const port = await closedPort();
    testApp = await createTestApp({ config: { databaseUrl: urlTo(port) } });
    const api = client(testApp.server);
    const flow = leads();
    flow.nodes[0].color = 'rojo';
    const res = await api.create(flow).expect(400);
    expect(res.body.error).toBe('invalid_flow');
  });
});

/** Copia de `url` con un cambio. */
function withChange(url: URL, change: (copy: URL) => void): string {
  const copy = new URL(url);
  change(copy);
  return copy.toString();
}
