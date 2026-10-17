import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const PRELOAD = fileURLToPath(new URL('../scripts/local-only-preload.cjs', import.meta.url));
const CHILD = fileURLToPath(new URL('./helpers/preload-child.cjs', import.meta.url));

interface Report {
  openThrows: boolean;
  promisesOpenThrows: boolean;
  wildcardOpenThrows: boolean;
  wildcardPrefixedOpenThrows: boolean;
  middleware: { status: number; body: string };
  url: string | null;
}

interface Running {
  child: ChildProcess;
  port: number;
  report: Report;
}

const children: ChildProcess[] = [];

/** Mata al hijo (SIGTERM y, si no basta, SIGKILL): ningún inspector queda vivo, ni en fallo ni por plazo. */
async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  await exited;
  clearTimeout(timer);
}

// Se mata siempre, también si un test falla o se agota el plazo: el mutante skipInspectorPatch abriría un inspector real.
afterAll(async () => {
  for (const child of children.splice(0)) await kill(child);
});

function start(): Promise<Running> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', PRELOAD, '--inspect-port=0', CHILD], { cwd: WEB, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    let out = '';
    let port: number | null = null;
    const timer = setTimeout(() => reject(new Error(`el hijo no arrancó a tiempo: ${out}`)), 15_000);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
      const portMatch = /PORT=(\d+)/.exec(out);
      if (portMatch) port = Number(portMatch[1]);
      const reportMatch = /REPORT=(.*)\n/.exec(out);
      if (reportMatch && port !== null) {
        clearTimeout(timer);
        resolve({ child, port, report: JSON.parse(reportMatch[1]!) as Report });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error(`el hijo terminó antes de tiempo: ${out}`));
    });
  });
}

/** Manda bytes en bruto y devuelve todo lo que responde el servidor hasta que cierra. */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('error', () => resolve(received));
    socket.on('close', () => resolve(received));
    socket.setTimeout(3000, () => socket.destroy());
    socket.write(text);
  });
}

const get = (host: string, extra = '') => `GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n${extra}\r\n`;
const statusOf = (response: string) => response.split('\r\n')[0];

let shared: Running | undefined;
async function child(): Promise<Running> {
  shared ??= await start();
  return shared;
}

describe('preload de la guarda local (D26)', () => {
  it('inspector.open lanza por todos los caminos, también el que usa Next, y el middleware real responde 500 sin URL', async () => {
    const { report } = await child();
    expect(report.openThrows).toBe(true);
    expect(report.promisesOpenThrows).toBe(true);
    expect(report.wildcardOpenThrows).toBe(true);
    expect(report.wildcardPrefixedOpenThrows).toBe(true);
    expect(report.middleware.status).toBe(500);
    expect(report.middleware.body).not.toMatch(/devtools|ws=|127\.0\.0\.1/);
    expect(report.url).toBeNull();
  });

  it('Host: la matriz en el evento request, con las cabeceras de marcos', async () => {
    const { port } = await child();
    const local = await raw(port, get(`localhost:${port}`));
    expect(statusOf(local)).toBe('HTTP/1.1 200 OK');
    expect(local).toMatch(/content-security-policy: frame-ancestors 'none'/i);
    expect(local).toMatch(/x-frame-options: DENY/i);
    for (const host of [`127.0.0.1:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) expect(statusOf(await raw(port, get(host))), host).toBe('HTTP/1.1 200 OK');
    for (const host of ['evil.example', `evil.example:${port}`, 'localhost.evil.example', '127.0.0.1.nip.io', 'localhost.']) {
      const rejected = await raw(port, get(host));
      expect(statusOf(rejected), host).toBe('HTTP/1.1 403 Forbidden');
      expect(rejected, host).not.toContain('ok');
      expect(rejected).toMatch(/x-frame-options: DENY/i);
      expect(rejected).toMatch(/content-security-policy: frame-ancestors 'none'/i);
    }
  });

  it('la matriz de /__nextjs_launch-editor: un Host ajeno da 403 (con un Host local la atiende el servidor)', async () => {
    const { port } = await child();
    for (const host of ['evil.example:3000', 'localhost.evil.example']) {
      const response = await raw(port, `GET /__nextjs_launch-editor?file=package.json HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      expect(statusOf(response)).toBe('HTTP/1.1 403 Forbidden');
    }
    const local = await raw(port, `GET /__nextjs_launch-editor?file=package.json HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
    expect(statusOf(local)).toBe('HTTP/1.1 200 OK');
  });

  it('checkContinue: Expect: 100-continue con un Host ajeno da 403 (sin la guarda daba 100 y después 200), y con uno local da 100', async () => {
    const { port } = await child();
    const request = (host: string) => `POST / HTTP/1.1\r\nHost: ${host}\r\nExpect: 100-continue\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`;
    const rejected = await raw(port, request('evil.example'));
    expect(statusOf(rejected)).toBe('HTTP/1.1 403 Forbidden');
    expect(rejected).not.toContain('100 Continue');
    expect(rejected).not.toContain('continued');
    const allowed = await raw(port, request(`localhost:${port}`));
    expect(allowed).toContain('HTTP/1.1 100 Continue');
    expect(allowed).toContain('continued');
  });

  it('checkExpectation: una expectativa distinta con un Host ajeno da 403, y con uno local llega al listener', async () => {
    const { port } = await child();
    const request = (host: string) => `GET / HTTP/1.1\r\nHost: ${host}\r\nExpect: algo-raro\r\nConnection: close\r\n\r\n`;
    expect(statusOf(await raw(port, request('evil.example')))).toBe('HTTP/1.1 403 Forbidden');
    const allowed = await raw(port, request(`localhost:${port}`));
    expect(statusOf(allowed)).toBe('HTTP/1.1 200 OK');
    expect(allowed).toContain('expectation');
  });

  it('upgrade: el Origin propio da 101; otro puerto de localhost, sin Origin o un Host ajeno dan 403', async () => {
    const { port } = await child();
    const upgrade = (host: string, origin?: string) =>
      `GET /_next/hmr HTTP/1.1\r\nHost: ${host}\r\n${origin === undefined ? '' : `Origin: ${origin}\r\n`}Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
    expect(statusOf(await raw(port, upgrade(`localhost:${port}`, `http://localhost:${port}`)))).toBe('HTTP/1.1 101 Switching Protocols');
    expect(statusOf(await raw(port, upgrade(`LOCALHOST:${port}`, `http://localhost:${port}`)))).toBe('HTTP/1.1 101 Switching Protocols');
    expect(statusOf(await raw(port, upgrade(`127.0.0.1:${port}`, `http://127.0.0.1:${port}`)))).toBe('HTTP/1.1 101 Switching Protocols');
    expect(statusOf(await raw(port, upgrade(`localhost:${port}`, 'http://localhost:5173')))).toBe('HTTP/1.1 403 Forbidden');
    expect(statusOf(await raw(port, upgrade(`localhost:${port}`)))).toBe('HTTP/1.1 403 Forbidden');
    expect(statusOf(await raw(port, upgrade(`localhost:${port}`, `http://127.0.0.1:${port}`)))).toBe('HTTP/1.1 403 Forbidden');
    expect(statusOf(await raw(port, upgrade('evil.example', 'http://evil.example')))).toBe('HTTP/1.1 403 Forbidden');
  });

  it('connect: un Host ajeno, o sin el Origin propio, da 403', async () => {
    const { port } = await child();
    const connect = (host: string, origin?: string) => `CONNECT example.com:443 HTTP/1.1\r\nHost: ${host}\r\n${origin === undefined ? '' : `Origin: ${origin}\r\n`}\r\n`;
    expect(statusOf(await raw(port, connect('evil.example', 'http://evil.example')))).toBe('HTTP/1.1 403 Forbidden');
    expect(statusOf(await raw(port, connect(`localhost:${port}`)))).toBe('HTTP/1.1 403 Forbidden');
    expect(statusOf(await raw(port, connect(`localhost:${port}`, 'http://localhost:5173')))).toBe('HTTP/1.1 403 Forbidden');
    expect(statusOf(await raw(port, connect(`localhost:${port}`, `http://localhost:${port}`)))).toBe('HTTP/1.1 200 Connection Established');
  });

  it('el hijo no deja ningún inspector abierto: se mata y no queda vivo', async () => {
    const { child: running } = await child();
    await kill(running);
    expect(running.exitCode !== null || running.signalCode !== null).toBe(true);
    shared = undefined;
  });
});
