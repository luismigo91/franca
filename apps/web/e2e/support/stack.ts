import { createTestDatabase, type TestDatabase } from './database';
import { launch, isListening, waitFor, REPO_DIR, WEB_DIR, type Managed } from './processes';
import { startFakeApi, type FakeApi } from '../../tests/helpers/fake-api';

export const WEB_PORT = 3000;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

export interface Stack {
  /** API simulada delante de la real: registra, reenvía y puede guionizar. */
  fakeApi: FakeApi;
  /** Dirección de la API real. */
  realApiUrl: string;
  /** Salida acumulada de la web de la pila. */
  webOutput(): string;
  /** Para la web, la vuelve a arrancar con el entorno dado (sobre `FRANCA_API_URL` hacia la API simulada) y espera a que responda. */
  restartWeb(env?: Record<string, string | undefined>): Promise<void>;
  stopWeb(): Promise<void>;
  /** Vacía la base y el registro y el guion de la API simulada. */
  reset(): Promise<void>;
}

const BASE_ENV = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: '1' };

/** Arranca `pnpm --filter @franca/web <script>` y espera a que responda en 127.0.0.1:3000 con un Host local. */
export async function startWeb(script: 'start' | 'dev', env: Record<string, string | undefined>): Promise<Managed> {
  const web = launch('pnpm', ['--filter', '@franca/web', script], { cwd: REPO_DIR, env: { ...BASE_ENV, ...env } });
  await waitFor(
    async () => {
      if (web.child.exitCode !== null) throw new Error(`la web terminó antes de escuchar:\n${web.output()}`);
      try {
        const response = await fetch(`http://127.0.0.1:${WEB_PORT}/`, { headers: { Host: `localhost:${WEB_PORT}` } });
        return response.status === 200;
      } catch {
        return false;
      }
    },
    `la web (${script}) en 127.0.0.1:${WEB_PORT}`,
    120_000,
  );
  return web;
}

/** Aborta con un mensaje claro si el 3000 está ocupado. */
export async function assertPortFree(): Promise<void> {
  if (await isListening(WEB_PORT) || (await isListening(WEB_PORT, '::1'))) {
    throw new Error(`El puerto ${WEB_PORT} está ocupado: para \`pnpm dev\` (o lo que lo use) antes de los E2E.`);
  }
}

/** La pila única de la ejecución (D20): base, API real, API simulada y web. */
export async function startStack(): Promise<{ stack: Stack; close: () => Promise<void>; database: TestDatabase }> {
  await assertPortFree();
  const database = await createTestDatabase();
  let api: Managed | undefined;
  let fakeApi: FakeApi | undefined;
  let web: Managed | undefined;
  const close = async () => {
    await web?.stop();
    await fakeApi?.close();
    await api?.stop();
    await database.drop();
  };
  try {
    // Entorno mínimo: sin FRANCA_ANTHROPIC_API_KEY ni FRANCA_SECRET_* / FRANCA_HTTP_*, así que nada sale a Anthropic ni a un CRM.
    api = launch('node', ['apps/api/dist/main.js'], { cwd: REPO_DIR, env: { PATH: process.env.PATH, DATABASE_URL: database.url, HOST: '127.0.0.1', PORT: '0' } });
    let apiPort = 0;
    await waitFor(
      () => {
        if (api!.child.exitCode !== null) throw new Error(`la API terminó antes de escuchar:\n${api!.output().split(database.url).join('<DATABASE_URL>')}`);
        const match = /escuchando en 127\.0\.0\.1:(\d+)/.exec(api!.output().replace(/\u001b\[[0-9;]*m/g, ''));
        if (match) apiPort = Number(match[1]);
        return apiPort !== 0;
      },
      'la API real',
    );
    fakeApi = await startFakeApi();
    fakeApi.forwardTo(apiPort);
    const stack: Stack = {
      fakeApi,
      realApiUrl: `http://127.0.0.1:${apiPort}`,
      webOutput: () => web?.output() ?? '',
      async stopWeb() {
        await web?.stop();
        web = undefined;
        await waitFor(async () => !(await isListening(WEB_PORT)), 'que el 3000 quede libre', 20_000);
      },
      async restartWeb(env = {}) {
        await stack.stopWeb();
        web = await startWeb('start', { FRANCA_API_URL: fakeApi!.url, ...env });
      },
      async reset() {
        await database.truncate();
        fakeApi!.reset();
        fakeApi!.forwardTo(apiPort);
        if (!web) await stack.restartWeb();
      },
    };
    web = await startWeb('start', { FRANCA_API_URL: fakeApi.url });
    return { stack, close, database };
  } catch (error) {
    await close();
    throw error;
  }
}

export { WEB_DIR };
