import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, inject, it } from 'vitest';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const VITEST = join(API_DIR, 'node_modules/.bin/vitest');

/** Un servidor TCP local que hace de proxy: anota la primera línea de cada conexión y la cierra sin reenviar nada. */
async function startRecordingProxy(): Promise<{ port: number; lines(): string[]; connections(): number; close(): Promise<void> }> {
  const lines: string[] = [];
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', (chunk) => {
      lines.push(chunk.toString('latin1').split('\r\n')[0]!);
      socket.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    lines: () => [...lines],
    connections: () => connections,
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('salida http: entorno del proceso (e2e)', () => {
  const cleanup: (() => void | Promise<void>)[] = [];
  afterAll(async () => {
    for (const step of cleanup.splice(0)) await step();
  });

  it('Proxy del entorno ignorado', async () => {
    const proxy = await startRecordingProxy();
    cleanup.push(() => proxy.close());
    const dir = mkdtempSync(join(tmpdir(), 'franca-proxy-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const report = join(dir, 'informe.json');
    const url = `http://127.0.0.1:${proxy.port}`;

    // Un Vitest que nace con NODE_USE_ENV_PROXY=1 y las variables de proxy (en las dos cajas) hacia el proxy local.
    // NO_PROXY exime solo a los destinos de loopback, para que el cliente del test llegue a la API; la salida de la
    // API va a crm.example.com, que no está exento.
    const child = spawn(VITEST, ['run', '--config', 'vitest.config.e2e-hostile.ts', '--reporter=json', `--outputFile=${report}`], {
      cwd: API_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        DATABASE_URL: inject('databaseUrl'),
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: url,
        HTTPS_PROXY: url,
        ALL_PROXY: url,
        http_proxy: url,
        https_proxy: url,
        all_proxy: url,
        NO_PROXY: '127.0.0.1,::1,localhost',
        no_proxy: '127.0.0.1,::1,localhost',
        CHECKPOINT_DISABLE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));

    expect(code, output.slice(-2000)).toBe(0);
    const parsed = JSON.parse(readFileSync(report, 'utf8')) as { numPassedTests: number; numFailedTests: number; testResults: { assertionResults: { title: string; status: string }[] }[] };
    expect(parsed.numFailedTests).toBe(0);
    expect(parsed.testResults.flatMap((file) => file.assertionResults).filter((test) => test.title === 'Proxy del entorno ignorado' && test.status === 'passed')).toHaveLength(1);
    // El proxy no recibió nada: ni la salida http (crm.example.com) ni ninguna otra pieza del hijo.
    expect(proxy.lines().filter((line) => line.includes('crm.example.com'))).toEqual([]);
    expect(proxy.lines()).toEqual([]);
    expect(proxy.connections()).toBe(0);
  }, 180_000);
});
