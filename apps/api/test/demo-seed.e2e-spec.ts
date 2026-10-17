import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { seedDemo } from '../demo/seed.mjs';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { resetConversations } from './helpers/conversations.js';
import { createTestPrisma } from './helpers/database.js';
import { startApi, type RunningApi } from './helpers/process.js';

const SEED_SCRIPT = fileURLToPath(new URL('../demo/seed.mjs', import.meta.url));
const copy = JSON.parse(readFileSync(new URL('../demo/captacion-leads-local.json', import.meta.url), 'utf8'));
const FAKE_DATABASE_URL = 'postgresql://usuario:no-mostrar-1234@127.0.0.1:59999/franca';

interface SeedRun {
  ok?: boolean;
  code?: number | null;
  text: string;
  ms: number;
}

/** `pnpm demo:seed` como proceso real: el código de salida y todo lo que escribe. */
async function seedAsProcess(apiUrl: string | undefined): Promise<SeedRun> {
  const started = performance.now();
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  if (apiUrl !== undefined) env.FRANCA_API_URL = apiUrl;
  const child = spawn(process.execPath, [SEED_SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
  const [code] = (await once(child, 'exit')) as [number | null];
  return { code, text, ms: performance.now() - started };
}

/** `seedDemo` en este mismo proceso, contra `apiUrl`. */
async function seedInProcess(apiUrl: string): Promise<SeedRun> {
  const started = performance.now();
  const lines: string[] = [];
  const { ok } = await seedDemo({ env: { FRANCA_API_URL: apiUrl }, write: (line: string) => lines.push(line) });
  return { ok, text: lines.join('\n'), ms: performance.now() - started };
}

/** Un puerto de loopback en el que no escucha nadie. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('semilla de la demo contra la API real (e2e)', () => {
  const prisma = createTestPrisma();
  let api: RunningApi;
  let apiUrl: string;

  beforeAll(async () => {
    api = startApi({ DATABASE_URL: inject('databaseUrl'), PORT: '0' });
    const listening = await api.whenListening();
    if (!listening) throw new Error(`la API no arrancó:\n${api.output()}`);
    apiUrl = `http://${listening.host}:${listening.port}`;
  });
  afterAll(async () => {
    await api.stop();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetConversations(prisma);
  });

  const versions = async (): Promise<{ total: number }> => (await fetch(`${apiUrl}/flows/captacion-leads-local/versions`)).json() as Promise<{ total: number }>;
  const draft = async (): Promise<{ name: string; revision: number; etag: string }> => {
    const response = await fetch(`${apiUrl}/flows/captacion-leads-local`);
    const body = (await response.json()) as { flow: { name: string }; revision: number };
    return { name: body.flow.name, revision: body.revision, etag: response.headers.get('etag')! };
  };

  it('Primera siembra', async () => {
    const first = await seedInProcess(apiUrl);
    expect(first.ok).toBe(true);
    expect(first.text).toContain('captacion-leads-local: creado y publicado (versión 1).');
    const version = await fetch(`${apiUrl}/flows/captacion-leads-local/versions/1`);
    expect(version.status).toBe(200);
    expect(((await version.json()) as { flow: unknown }).flow).toEqual(copy);

    // Y una vez como proceso real, para el código de salida, sobre una base vacía.
    await resetConversations(prisma);
    const real = await seedAsProcess(apiUrl);
    expect(real.code).toBe(0);
    expect(real.text).toContain('creado y publicado');
  });

  it('Siembra repetida', async () => {
    expect((await seedAsProcess(apiUrl)).code).toBe(0);
    for (let round = 0; round < 2; round += 1) {
      const again = await seedAsProcess(apiUrl);
      expect(again.code).toBe(0);
      expect(again.text).toContain('ya estaba publicado (versión 1)');
    }
    expect((await versions()).total).toBe(1);
    expect((await draft()).revision).toBe(1);
  });

  it('Copia creada sin publicar', async () => {
    const created = await fetch(`${apiUrl}/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(copy) });
    expect(created.status).toBe(201);
    const result = await seedAsProcess(apiUrl);
    expect(result.code).toBe(0);
    expect(result.text).toContain('captacion-leads-local: publicado (versión 1).');
    const version = await fetch(`${apiUrl}/flows/captacion-leads-local/versions/1`);
    expect(((await version.json()) as { flow: unknown }).flow).toEqual(copy);
  });

  it('Borrador cambiado a mano', async () => {
    expect((await seedAsProcess(apiUrl)).code).toBe(0);
    const before = await draft();
    const changed = await fetch(`${apiUrl}/flows/captacion-leads-local`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': before.etag },
      body: JSON.stringify({ ...copy, name: 'Mío' }),
    });
    expect(changed.status).toBe(200);
    const mine = await draft();
    expect(mine.name).toBe('Mío');

    const result = await seedAsProcess(apiUrl);
    expect(result.code).not.toBe(0);
    expect(result.text).toContain('captacion-leads-local');
    expect(result.text).toContain('su borrador no es la copia de la demo y no se ha tocado');
    const after = await draft();
    expect(after.name).toBe('Mío');
    expect(after.revision).toBe(mine.revision);
    expect((await versions()).total).toBe(1);
  });

  it('Id reservado por un borrado', async () => {
    expect((await seedAsProcess(apiUrl)).code).toBe(0);
    expect((await fetch(`${apiUrl}/flows/captacion-leads-local`, { method: 'DELETE' })).status).toBe(204);
    const result = await seedAsProcess(apiUrl);
    expect(result.code).not.toBe(0);
    expect(result.text).toContain('reservado');
    expect(result.text).toContain('docker compose down -v');
  });

  describe('con procesos propios', () => {
    const running: RunningApi[] = [];
    afterEach(async () => {
      await Promise.all(running.splice(0).map((stopped) => stopped.stop()));
    });

    it('API no disponible para la semilla', async () => {
      const port = await closedPort();
      const refused = await seedAsProcess(`http://127.0.0.1:${port}`);
      expect(refused.code).not.toBe(0);
      expect(refused.ms).toBeLessThan(15_000);
      expect(refused.text).toContain(`No puedo conectar con la API de Franca en http://127.0.0.1:${port}`);

      const broken = startApi({ DATABASE_URL: FAKE_DATABASE_URL, PORT: '0' });
      running.push(broken);
      const listening = await broken.whenListening();
      expect(listening).toBeDefined();
      const unavailable = await seedAsProcess(`http://${listening!.host}:${listening!.port}`);
      expect(unavailable.code).not.toBe(0);
      expect(unavailable.ms).toBeLessThan(15_000);
      expect(unavailable.text).toContain('La base de datos no responde');
      expect(unavailable.text).toContain('docker compose up -d');
      expect(unavailable.text).not.toContain('no-mostrar-1234');
    });
  });

  it('Base de datos sin migraciones para la semilla', async () => {
    const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: inject('databaseUrl') }), errorFormat: 'minimal' });
    const name = `franca_e2e_${process.pid}_vacia`;
    const url = new URL(inject('databaseUrl'));
    url.pathname = `/${name}`;
    let empty: RunningApi | undefined;
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      empty = startApi({ DATABASE_URL: url.toString(), PORT: '0' });
      const listening = await empty.whenListening();
      expect(listening).toBeDefined();
      const result = await seedAsProcess(`http://${listening!.host}:${listening!.port}`);
      expect(result.code).toBe(1);
      expect(result.text).toContain('pnpm --filter @franca/api db:migrate');
    } finally {
      await empty?.stop();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    }
  });
});
