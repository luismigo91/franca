import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trustedAuthority } from './helpers/test-pki.js';
import { TestServers, type TestServer } from './helpers/test-servers.js';

/**
 * La red de producción de verdad (`systemNetwork()`: `dns.promises.lookup` y `net.connect` reales, sin la costura del test ni
 * `ca` propia), ejecutada en un proceso hijo con el entorno que se quiere probar, siempre dentro de loopback:
 * - TLS contra las autoridades de Node y `NODE_EXTRA_CA_CERTS`, que Node lee al arrancar;
 * - `NODE_TLS_REJECT_UNAUTHORIZED=0` y el proxy del entorno, que no cambian nada.
 * El nombre es `localhost`, que el motor nunca deja pasar en una `url` pero que el host trata como cualquier nombre.
 */
const DIST = fileURLToPath(new URL('../dist/http-host/', import.meta.url));

const CHILD = `
import { pathToFileURL } from 'node:url';
const load = (name) => import(pathToFileURL(process.env.QA_DIST + name).href);
const { createHttpHost } = await load('http-host.js');
const { systemNetwork } = await load('network.js');
const { createAllowedDestinations } = await load('destination-policy.js');
const { createSecretStore } = await load('secrets.js');
const keys = JSON.parse(process.env.QA_ALLOWED);
const host = createHttpHost({
  secrets: createSecretStore(new Map()),
  allowed: createAllowedDestinations(keys.map((key) => ({ key }))),
  network: systemNetwork(),
  notices: { missingSecret() {}, blocked() {} },
});
const capability = host.forAdvance({ conversationId: 'c', deadlineMs: Date.now() + 60000, now: () => Date.now() });
const result = await capability({ nodeId: 'n', method: 'GET', url: process.env.QA_URL, headers: [], body: null, timeoutMs: 6000, attempt: 1, containsPii: false });
process.stdout.write('RESULT ' + JSON.stringify(result) + '\\n');
`;

/** Canario: un `http.get` corriente con el mismo entorno SÍ pasa por el proxy (si no, la prueba del proxy no probaría nada). */
const CANARY = `
import http from 'node:http';
await new Promise((resolve) => {
  const request = http.get(process.env.QA_URL, () => resolve());
  request.on('error', () => resolve());
  setTimeout(resolve, 3000).unref();
});
process.stdout.write('RESULT {"kind":"canary"}\\n');
process.exit(0);
`;

interface Outcome {
  readonly result: {
    kind: string;
    status?: number;
    body?: string;
    requestSent?: boolean;
  };
}

function runChild(
  env: Record<string, string>,
  script = CHILD,
): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        env: { PATH: process.env.PATH ?? '', QA_DIST: DIST, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout
        .split('\n')
        .find((candidate) => candidate.startsWith('RESULT '));
      if (line === undefined)
        reject(new Error(`el hijo no dio resultado:\n${stdout}\n${stderr}`));
      else resolve({ result: JSON.parse(line.slice('RESULT '.length)) });
    });
  });
}

describe('QA salida http: la red de producción en un proceso hijo (e2e)', () => {
  const servers = new TestServers();
  const directory = mkdtempSync(join(tmpdir(), 'franca-qa-autoridad-'));
  const authorityFile = join(directory, 'autoridad-de-prueba.crt');
  let good: TestServer;
  let untrusted: TestServer;
  let otherName: TestServer;
  let plain: TestServer;
  let proxy: Server;
  const proxyConnections = new Set<Socket>();
  let proxyCount = 0;
  let proxyPort = 0;

  beforeAll(async () => {
    writeFileSync(authorityFile, trustedAuthority.certificate);
    good = await servers.start(
      { kind: 'respond', status: 200, body: 'bien' },
      { tls: { hostname: 'localhost', authority: 'trusted' } },
    );
    untrusted = await servers.start(
      { kind: 'respond', status: 200, body: 'mal' },
      { tls: { hostname: 'localhost', authority: 'untrusted' } },
    );
    otherName = await servers.start(
      { kind: 'respond', status: 200, body: 'mal' },
      { tls: { hostname: 'otro.example.com', authority: 'trusted' } },
    );
    plain = await servers.start({
      kind: 'respond',
      status: 200,
      body: 'claro',
    });
    proxy = createServer((socket) => {
      proxyCount++;
      proxyConnections.add(socket);
      socket.on('error', () => undefined);
      socket.destroy();
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    proxyPort = (proxy.address() as { port: number }).port;
  });
  afterAll(async () => {
    await servers.closeAll();
    proxyConnections.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });

  const allowing = (...targets: TestServer[]): string =>
    JSON.stringify(
      targets.flatMap((server) => [
        `127.0.0.1|${server.port}`,
        `::1|${server.port}`,
      ]),
    );
  const call = (
    server: TestServer,
    scheme: 'https' | 'http',
    env: Record<string, string> = {},
    allowed = allowing(server),
  ) =>
    runChild({
      QA_URL: `${scheme}://localhost:${server.port}/`,
      QA_ALLOWED: allowed,
      ...env,
    });

  it('con NODE_EXTRA_CA_CERTS que contiene la autoridad del servidor, el TLS verifica y la respuesta llega (resolutor y conexión reales)', async () => {
    const { result } = await call(good, 'https', {
      NODE_EXTRA_CA_CERTS: authorityFile,
    });
    expect(result).toEqual({ kind: 'response', status: 200, body: 'bien' });
  });

  it('sin NODE_EXTRA_CA_CERTS la misma autoridad no es de confianza: network_error sin enviar la petición', async () => {
    const before = good.received().length;
    const { result } = await call(good, 'https');
    expect(result).toEqual({ kind: 'network_error', requestSent: false });
    expect(good.received()).toHaveLength(before);
  });

  it.each([
    ['sin autoridad extra', {}],
    [
      'con NODE_TLS_REJECT_UNAUTHORIZED=0',
      { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    ],
    [
      'con NODE_TLS_REJECT_UNAUTHORIZED=0 y otra autoridad aceptada',
      { NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_EXTRA_CA_CERTS: authorityFile },
    ],
  ])(
    'un certificado de una autoridad desconocida se rechaza %s',
    async (_label, env) => {
      const { result } = await call(untrusted, 'https', env);
      expect(result).toEqual({ kind: 'network_error', requestSent: false });
      expect(untrusted.received()).toHaveLength(0);
    },
  );

  it.each([
    ['NODE_EXTRA_CA_CERTS', { NODE_EXTRA_CA_CERTS: authorityFile }],
    [
      'NODE_TLS_REJECT_UNAUTHORIZED=0',
      { NODE_EXTRA_CA_CERTS: authorityFile, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    ],
  ])(
    'un certificado de confianza pero de otro nombre se rechaza con %s',
    async (_label, env) => {
      const { result } = await call(otherName, 'https', env);
      expect(result).toEqual({ kind: 'network_error', requestSent: false });
      expect(otherName.received()).toHaveLength(0);
    },
  );

  it('el proxy del entorno (en mayúsculas, minúsculas y NODE_USE_ENV_PROXY) no recibe ninguna conexión', async () => {
    const proxyUrl = `http://127.0.0.1:${proxyPort}`;
    const before = proxyCount;
    const { result } = await call(good, 'https', {
      NODE_EXTRA_CA_CERTS: authorityFile,
      NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: proxyUrl,
      HTTP_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      http_proxy: proxyUrl,
      all_proxy: proxyUrl,
      NO_PROXY: '',
    });
    expect(result).toEqual({ kind: 'response', status: 200, body: 'bien' });
    const plainResult = await call(plain, 'http', {
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      ALL_PROXY: proxyUrl,
    });
    expect(plainResult.result).toEqual({
      kind: 'response',
      status: 200,
      body: 'claro',
    });
    expect(proxyCount).toBe(before);
  });

  it('canario: con NODE_USE_ENV_PROXY=1 un http.get corriente sí va al proxy del entorno (la prueba anterior detectaría un desvío)', async () => {
    const proxyUrl = `http://127.0.0.1:${proxyPort}`;
    const before = proxyCount;
    await runChild(
      {
        QA_URL: `http://localhost:${plain.port}/`,
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        NO_PROXY: '',
      },
      CANARY,
    );
    expect(proxyCount).toBeGreaterThan(before);
  });

  it('http:// a localhost solo llega si la instalación permite sus direcciones (la resolución real se mira entera)', async () => {
    const none = await call(plain, 'http', {}, '[]');
    expect(none.result).toEqual({ kind: 'blocked' });
    const onlyV4 = await call(
      plain,
      'http',
      {},
      JSON.stringify([`127.0.0.1|${plain.port}`]),
    );
    // `localhost` puede resolver también a ::1: entonces se bloquea entero; si solo es 127.0.0.1, llega.
    expect(['blocked', 'response']).toContain(onlyV4.result.kind);
    const both = await call(plain, 'http');
    expect(both.result).toEqual({
      kind: 'response',
      status: 200,
      body: 'claro',
    });
  });

  it('https://localhost sin permiso se bloquea antes de abrir ninguna conexión (el servidor no ve ni el TCP)', async () => {
    const connectionsBefore = good.connections();
    const { result } = await call(
      good,
      'https',
      { NODE_EXTRA_CA_CERTS: authorityFile },
      '[]',
    );
    expect(result).toEqual({ kind: 'blocked' });
    expect(good.connections()).toBe(connectionsBefore);
  });
});
