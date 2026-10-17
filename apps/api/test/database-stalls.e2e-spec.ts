import { connect, createServer, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { hola } from './helpers/examples.js';

const UNAVAILABLE = { message: expect.any(String), error: 'database_unavailable' };
const LIMIT_MS = 10_000;

/**
 * Una base que no se cae pero deja de atender: otra sesión retiene un bloqueo de tabla (una migración larga, un
 * `ALTER TABLE`, un `VACUUM FULL`), Postgres corta la conexión a mitad de una consulta (reinicio, conmutación por
 * error) o el servidor enmudece después de aceptar la transacción. La spec («Base de datos no disponible») pide 503
 * `database_unavailable` en menos de 10 s en todos los endpoints que leen o escriben flujos; un 500 sería un fallo del
 * propio código y solo corresponde a «Transacción caducada por el propio código».
 */
describe('base de datos que retiene o corta una consulta (e2e)', () => {
  let testApp: TestApp | undefined;
  let prisma: PrismaClient;
  let locker: PrismaClient;
  let api: ApiClient;
  let release: (() => Promise<void>) | undefined;
  let proxy: CuttingProxy | undefined;

  beforeEach(async () => {
    prisma = createTestPrisma();
    locker = createTestPrisma();
    await resetDatabase(prisma);
    testApp = await createTestApp();
    api = client(testApp.server);
  });

  afterEach(async () => {
    await release?.();
    release = undefined;
    await proxy?.close();
    proxy = undefined;
    await testApp?.close();
    testApp = undefined;
    await locker.$disconnect();
    await prisma.$disconnect();
  });

  /** Otra conexión toma `LOCK TABLE … IN ACCESS EXCLUSIVE MODE` y no termina hasta que se llame a `release`. */
  async function lockTable(table: 'flows' | 'flow_versions'): Promise<void> {
    await holdLock(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
  }

  /** Otra conexión toma el bloqueo de la fila de `hola` (`SELECT … FOR UPDATE`) y no termina hasta que se llame a `release`. */
  async function lockRow(): Promise<void> {
    await holdLock(`SELECT id FROM flows WHERE id = 'hola' FOR UPDATE`);
  }

  async function holdLock(statement: string): Promise<void> {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => (locked = resolve));
    const transaction = locker
      .$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(statement);
          locked();
          await held;
        },
        { timeout: 120_000 },
      )
      .catch(() => locked());
    await acquired;
    release = async () => {
      finish();
      await transaction;
    };
  }

  const timed = async <T>(run: () => PromiseLike<T>): Promise<{ result: T; ms: number }> => {
    const started = performance.now();
    const result = await run();
    return { result, ms: performance.now() - started };
  };

  it('Tabla de flujos retenida', async () => {
    await api.create(hola()).expect(201);
    await lockTable('flows');

    const requests = {
      'GET /flows/hola': () => api.get('hola'),
      'GET /flows': () => api.list(),
      'POST /flows': () => api.create({ ...hola(), id: 'otro' }),
      'PUT /flows/hola': () => api.update('hola', { ...hola(), name: 'Otro' }, '*'),
      'POST /flows/hola/versions': () => api.publish('hola'),
      'DELETE /flows/hola': () => api.remove('hola'),
    };
    const outcomes = await Promise.all(Object.entries(requests).map(async ([name, run]) => ({ name, ...(await timed(run)) })));
    for (const { name, result, ms } of outcomes) {
      expect({ name, status: result.status, body: result.body }).toEqual({ name, status: 503, body: UNAVAILABLE });
      expect(ms, name).toBeLessThan(LIMIT_MS);
    }
  }, 40_000);

  it('Tabla de versiones retenida', async () => {
    await api.create(hola()).expect(201);
    await api.publish('hola').expect(201);
    await lockTable('flow_versions');

    const { result, ms } = await timed(() => api.versions('hola'));
    expect({ status: result.status, body: result.body }).toEqual({ status: 503, body: UNAVAILABLE });
    expect(ms).toBeLessThan(LIMIT_MS);
  }, 40_000);

  it('Conexión cortada por el servidor', async () => {
    await api.create(hola()).expect(201);
    const requests = {
      // El lector espera el bloqueo de la tabla; los escritores, el de la fila (el `FOR UPDATE` de `withLockedFlow`).
      'GET /flows/hola': { hold: () => lockTable('flows'), send: () => api.get('hola') },
      'PUT /flows/hola': { hold: lockRow, send: () => api.update('hola', { ...hola(), name: 'Otro' }, '*') },
      'POST /flows/hola/versions': { hold: lockRow, send: () => api.publish('hola') },
    };
    for (const [name, { hold, send }] of Object.entries(requests)) {
      await hold();
      const pending = send().then((res) => res);
      await terminateWaitingBackends();
      const res = await pending;
      expect({ name, status: res.status, body: res.body }).toEqual({ name, status: 503, body: UNAVAILABLE });
      await release?.();
      release = undefined;
    }
  }, 40_000);

  it('Postgres que enmudece a mitad de una transacción', async () => {
    await api.create(hola()).expect(201);
    await testApp?.close();
    proxy = await startCuttingProxy(new URL(process.env.DATABASE_URL ?? ''), 'FOR UPDATE');
    const target = new URL(process.env.DATABASE_URL ?? '');
    target.hostname = '127.0.0.1';
    target.port = String(proxy.port);
    testApp = await createTestApp({ config: { databaseUrl: target.toString() } });
    api = client(testApp.server);

    const requests = {
      'PUT /flows/hola': () => api.update('hola', { ...hola(), name: 'Otro' }, '*'),
      'POST /flows/hola/versions': () => api.publish('hola'),
    };
    const outcomes = await Promise.all(Object.entries(requests).map(async ([name, run]) => ({ name, ...(await timed(run)) })));
    for (const { name, result, ms } of outcomes) {
      expect({ name, status: result.status, body: result.body }).toEqual({ name, status: 503, body: UNAVAILABLE });
      expect(ms, name).toBeLessThan(LIMIT_MS);
    }
  }, 40_000);

  /** Espera a que alguna consulta de la API esté parada en un bloqueo y termina esas conexiones desde el servidor. */
  async function terminateWaitingBackends(): Promise<void> {
    const deadline = Date.now() + 5000;
    let waiting = 0;
    while (waiting === 0 && Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      waiting = rows[0]?.n ?? 0;
      if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting, 'la consulta de la API debía esperar al bloqueo').toBeGreaterThan(0);
    await prisma.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  }
});

interface CuttingProxy {
  port: number;
  close(): Promise<void>;
}

/**
 * Proxy TCP hacia Postgres que, cuando una petición del cliente contiene `pattern`, la reenvía y deja de transmitir
 * nada más en ninguna dirección (sin cerrar los sockets): el servidor «enmudece» justo a mitad de una transacción.
 */
async function startCuttingProxy(target: URL, pattern: string): Promise<CuttingProxy> {
  const sockets = new Set<Socket>();
  const server = createServer((downstream) => {
    const upstream = connect({ host: target.hostname, port: Number(target.port || 5432) });
    sockets.add(downstream);
    sockets.add(upstream);
    let silent = false;
    downstream.on('data', (chunk: Buffer) => {
      if (silent) return;
      upstream.write(chunk);
      if (chunk.includes(pattern)) silent = true;
    });
    upstream.on('data', (chunk: Buffer) => {
      if (!silent) downstream.write(chunk);
    });
    for (const socket of [downstream, upstream]) {
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
