import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import type { TestProject } from 'vitest/node';
import { PrismaClient } from '../src/generated/prisma/client.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Cadena de conexión a la base creada para esta ejecución de los e2e. */
    databaseUrl: string;
  }
}

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const PRISMA_BIN = fileURLToPath(new URL('../node_modules/.bin/prisma', import.meta.url));
const CONNECT_TIMEOUT_MS = 5000;

/** Cliente de administración sobre la base que indica `DATABASE_URL`. */
function adminClient(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS }),
    errorFormat: 'minimal',
  });
}

/** Ejecuta la CLI de Prisma contra `url`; si falla, lanza sin el valor de la URL en el mensaje. */
function runPrisma(args: string[], url: string): void {
  try {
    execFileSync(PRISMA_BIN, args, { cwd: API_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  } catch (error) {
    const output = String((error as { stderr?: Buffer }).stderr ?? '') + String((error as { stdout?: Buffer }).stdout ?? '');
    const safe = output.split(url).join('<DATABASE_URL>').split('\n').slice(-12).join('\n');
    throw new Error(`prisma ${args.slice(0, 2).join(' ')} falló al preparar la base de los e2e:\n${safe}`);
  }
}

/**
 * Crea una base `franca_e2e_*`, aplica las migraciones desde cero, comprueba que esquema y migraciones no divergen
 * y la borra al terminar. Necesita `DATABASE_URL` apuntando a un Postgres (en local: `docker compose up -d`).
 */
export default async function setup({ provide }: TestProject): Promise<() => Promise<void>> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error('Los e2e necesitan DATABASE_URL (la cadena de conexión a Postgres). En local: `docker compose up -d`.');
  }
  const name = `franca_e2e_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin = adminClient(adminUrl);
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } catch {
    await admin.$disconnect().catch(() => undefined);
    throw new Error('No se pudo crear la base de los e2e: ¿está levantado Postgres? (`docker compose up -d`) ¿es correcta DATABASE_URL?');
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const testUrl = url.toString();
  try {
    runPrisma(['migrate', 'deploy'], testUrl);
    runPrisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], testUrl);
  } catch (error) {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
    throw error;
  }

  // Los procesos de test heredan esta variable: apuntan a la base propia, no a la de desarrollo.
  process.env.DATABASE_URL = testUrl;
  provide('databaseUrl', testUrl);

  return async () => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  };
}
