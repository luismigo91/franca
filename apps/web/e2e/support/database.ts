import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../../tests/helpers/paths';
import pg from 'pg';

const API_DIR = resolve(REPO_ROOT, 'apps/api');
const PRISMA_BIN = resolve(API_DIR, 'node_modules/.bin/prisma');

export interface TestDatabase {
  url: string;
  /** Vacía todas las tablas de `public` salvo `_prisma_migrations`. */
  truncate(): Promise<void>;
  drop(): Promise<void>;
}

/** Crea `franca_web_e2e_<pid>` sobre `DATABASE_URL` y aplica las migraciones de la API. Los errores nunca muestran la URL. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('Los E2E de la web necesitan DATABASE_URL (la cadena de conexión a Postgres). En local: `docker compose up -d`.');
  const name = `franca_web_e2e_${process.pid}_${randomBytes(3).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch {
    await admin.end().catch(() => undefined);
    throw new Error('No se pudo crear la base de los E2E: ¿está levantado Postgres (`docker compose up -d`) y es correcta DATABASE_URL?');
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const testUrl = url.toString();
  const drop = async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  };
  try {
    execFileSync(PRISMA_BIN, ['migrate', 'deploy'], { cwd: API_DIR, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DATABASE_URL: testUrl, NODE_ENV: 'production' }, stdio: 'pipe' });
  } catch (error) {
    const output = String((error as { stderr?: Buffer }).stderr ?? '') + String((error as { stdout?: Buffer }).stdout ?? '');
    await drop();
    throw new Error(`prisma migrate deploy falló al preparar la base de los E2E:\n${output.split(testUrl).join('<DATABASE_URL>').split('\n').slice(-10).join('\n')}`);
  }
  const db = new pg.Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 });
  await db.connect();
  return {
    url: testUrl,
    async truncate() {
      const { rows } = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
      if (rows.length === 0) return;
      await db.query(`TRUNCATE ${rows.map((row) => `"${row.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    },
    async drop() {
      await db.end().catch(() => undefined);
      await drop();
    },
  };
}
