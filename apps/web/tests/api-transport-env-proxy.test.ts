import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { sendJson, startFakeApi, type FakeApi } from './helpers/fake-api';

const VITEST = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** Un «proxy» que solo cuenta las conexiones que recibe y las cierra. */
async function startTrap(): Promise<{ port: number; connections: () => number }> {
  let count = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    count += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as net.AddressInfo).port, connections: () => count };
}

async function fake(): Promise<FakeApi> {
  const api = await startFakeApi();
  api.respond((_request, response) => sendJson(response, 200, { pong: true }));
  closers.push(() => api.close());
  return api;
}

/** Ejecuta un fichero hostil en un proceso hijo de Vitest con el proxy del entorno apuntando a la trampa. */
function runHostile(file: string, apiUrl: string, trapPort: number): Promise<{ status: number | null; output: string }> {
  const proxy = `http://127.0.0.1:${trapPort}`;
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NODE_USE_ENV_PROXY: '1',
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    all_proxy: proxy,
    HOSTILE_API_URL: apiUrl,
    FRANCA_API_URL: apiUrl,
    CI: '1',
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VITEST, 'run', '--config', 'vitest.hostile.config.mts', `tests/hostile/${file}`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
  });
}

describe('el proxy del entorno no afecta al transporte', () => {
  it('el control: un http.request normal con ese entorno acaba en la trampa', async () => {
    const [api, trap] = [await fake(), await startTrap()];
    const run = await runHostile('env-proxy-control.hostile.ts', api.url, trap.port);
    expect(run.status, run.output).toBe(0);
    expect(trap.connections()).toBeGreaterThan(0);
    expect(api.requests).toHaveLength(0);
  });

  it('con NODE_USE_ENV_PROXY=1 y las variables de proxy hacia una trampa, la API simulada recibe la petición y la trampa nada', async () => {
    const [api, trap] = [await fake(), await startTrap()];
    const run = await runHostile('env-proxy.hostile.ts', api.url, trap.port);
    expect(trap.connections(), `la trampa recibió una conexión: el transporte obedeció al proxy del entorno\n${run.output}`).toBe(0);
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /ping']);
    expect(run.status, run.output).toBe(0);
  });
});
