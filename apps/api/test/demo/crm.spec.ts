import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer, connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startCrm } from '../../demo/crm.mjs';

const TOKEN = 'Bearer t-1'; // gitleaks:allow
const CRM_SCRIPT = fileURLToPath(new URL('../../demo/crm.mjs', import.meta.url));

interface Reply {
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Una petición cruda al CRM; resuelve con la respuesta o rechaza con el error del socket (p. ej. `ECONNRESET`). */
function send(port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, agent: false, method: options.method ?? 'POST', path: options.path ?? '/api/leads', headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const AUTH = { Authorization: TOKEN };

describe('CRM simulado', () => {
  const closers: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  async function start(): Promise<{ port: number; lines: string[] }> {
    const lines: string[] = [];
    const crm = await startCrm({ token: TOKEN, port: 0, log: (line: string) => lines.push(line) });
    closers.push(() => crm.close());
    return { port: crm.port, lines };
  }

  it('Rutas y cuerpos que rechaza', async () => {
    const { port, lines } = await start();
    const cases = [
      { label: 'GET /api/leads', options: { method: 'GET' }, status: 404, error: 'not_found' },
      { label: 'POST /otra', options: { path: '/otra' }, status: 404, error: 'not_found' },
      { label: 'POST /api/leads?x=1 sin Authorization', options: { path: '/api/leads?x=1', headers: JSON_HEADERS, body: '{}' }, status: 401, error: 'unauthorized' },
      { label: 'text/plain', options: { headers: { ...AUTH, 'Content-Type': 'text/plain' }, body: '{}' }, status: 400, error: 'unsupported_media_type' },
      { label: 'array', options: { headers: { ...AUTH, ...JSON_HEADERS }, body: '[]' }, status: 400, error: 'invalid_body' },
      { label: 'cadena', options: { headers: { ...AUTH, ...JSON_HEADERS }, body: '"a"' }, status: 400, error: 'invalid_body' },
      { label: 'JSON truncado', options: { headers: { ...AUTH, ...JSON_HEADERS }, body: '{' }, status: 400, error: 'invalid_body' },
    ];
    for (const { label, options, status, error } of cases) {
      const reply = await send(port, options);
      expect(reply.status, label).toBe(status);
      expect(JSON.parse(reply.text), label).toEqual({ error });
      expect(reply.headers['content-type'], label).toBe('application/json');
      expect(reply.headers['connection'], label).toBe('close');
    }
    // Ningún id asignado: el siguiente lead válido es L-1.
    const ok = await send(port, { headers: { ...AUTH, ...JSON_HEADERS }, body: '{"a":1}' });
    expect(ok.status).toBe(201);
    expect(JSON.parse(ok.text)).toEqual({ id: 'L-1' });
    expect(lines.filter((line) => line.includes(' 400'))).toHaveLength(4);
  });

  it('rechaza con el 401 entero, sin ECONNRESET, un POST de 32 KiB sin Authorization', async () => {
    const { port } = await start();
    const reply = await send(port, { headers: JSON_HEADERS, body: Buffer.alloc(32 * 1024, 'a') });
    expect(reply.status).toBe(401);
    expect(JSON.parse(reply.text)).toEqual({ error: 'unauthorized' });
  });

  it('un token casi igual no vale', async () => {
    const { port } = await start();
    for (const wrong of ['Bearer t-2', 'bearer t-1', 'Bearer t-1x', 'Bearer t-']) {
      const reply = await send(port, { headers: { Authorization: wrong, ...JSON_HEADERS }, body: '{}' });
      expect(reply.status, wrong).toBe(401);
    }
  });

  it('responde 201 con L-1 y L-2 y escribe una línea por petición sin cabeceras, consulta ni cuerpo', async () => {
    const { port, lines } = await start();
    const first = await send(port, { path: '/api/leads?token=nada', headers: { ...AUTH, ...JSON_HEADERS }, body: '{"name":"Ana","email":"ana@example.com"}' });
    const second = await send(port, { headers: { ...AUTH, ...JSON_HEADERS }, body: '{}' });
    expect([first.status, second.status]).toEqual([201, 201]);
    expect([JSON.parse(first.text), JSON.parse(second.text)]).toEqual([{ id: 'L-1' }, { id: 'L-2' }]);
    expect(first.headers['content-type']).toBe('application/json');
    expect(lines).toEqual([expect.stringMatching(/^\[crm simulado\] escuchando en 127\.0\.0\.1:\d+$/), '[crm simulado] POST /api/leads 201 L-1', '[crm simulado] POST /api/leads 201 L-2']);
    const log = lines.join('\n');
    for (const forbidden of ['Ana', 'ana@example.com', 'token=nada', 't-1', 'Bearer', 'content-type', 'Content-Type']) expect(log).not.toContain(forbidden);
  });

  it('el registro sanea la ruta: ASCII visible y como mucho 200 caracteres', async () => {
    const { port, lines } = await start();
    await send(port, { method: 'GET', path: `/${'a'.repeat(300)}%C3%B1` });
    const line = lines.find((candidate) => candidate.includes(' 404'))!;
    expect(line).toBe(`[crm simulado] GET /${'a'.repeat(199)} 404`);
  });

  it('acepta application/json con parámetros y en cualquier caso, y rechaza un cuerpo de más de 64 KiB', async () => {
    const { port } = await start();
    for (const type of ['application/json; charset=utf-8', 'Application/JSON', ' application/json ;charset=utf-8']) {
      const reply = await send(port, { headers: { ...AUTH, 'Content-Type': type }, body: '{}' });
      expect(reply.status, type).toBe(201);
    }
    const big = JSON.stringify({ relleno: 'a'.repeat(65 * 1024) });
    const rejected = await send(port, { headers: { ...AUTH, ...JSON_HEADERS }, body: big });
    expect(rejected.status).toBe(400);
    expect(JSON.parse(rejected.text)).toEqual({ error: 'invalid_body' });
    const small = await send(port, { headers: { ...AUTH, ...JSON_HEADERS }, body: JSON.stringify({ relleno: 'a'.repeat(60 * 1024) }) });
    expect(small.status).toBe(201);
    expect(JSON.parse(small.text)).toEqual({ id: 'L-4' });
  });

  it('un cuerpo que no es UTF-8 es invalid_body', async () => {
    const { port } = await start();
    const reply = await send(port, { headers: { ...AUTH, ...JSON_HEADERS }, body: Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]) });
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text)).toEqual({ error: 'invalid_body' });
  });

  it('CRM solo en loopback', async () => {
    /** Intenta conectar; `true` si la conexión se acepta. */
    const accepts = (host: string, port: number): Promise<boolean> =>
      new Promise((resolve) => {
        const socket = connect({ host, port });
        socket.once('connect', () => (socket.destroy(), resolve(true)));
        socket.once('error', () => resolve(false));
      });
    const external = Object.values(networkInterfaces())
      .flatMap((list) => list ?? [])
      .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
    const { port } = await start();
    expect(await accepts('127.0.0.1', port)).toBe(true);
    // Sin interfaz de red local no hay una segunda dirección que probar: solo [::1].
    const others = ['::1', ...(external === undefined ? [] : [external])];
    expect(await Promise.all(others.map((host) => accepts(host, port)))).toEqual(others.map(() => false));
  });

  it('Puerto del CRM ocupado', async () => {
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => holder.close(() => resolve())));
    const { port } = holder.address() as { port: number };
    await expect(startCrm({ token: TOKEN, port, log: () => undefined })).rejects.toBe('EADDRINUSE');
  });
});

describe('CRM simulado como proceso', () => {
  const children: ReturnType<typeof fork>[] = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  function launch() {
    const child = fork(CRM_SCRIPT, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH ?? '' }, execArgv: [] });
    children.push(child);
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const next = (): Promise<{ type?: string; port?: number; code?: string }> => once(child, 'message').then(([message]) => message);
    return { child, next, output: () => output };
  }

  it('responde listening a start, atiende una petición y termina con stop', async () => {
    const { child, next, output } = launch();
    child.send({ type: 'start', token: TOKEN, port: 0 });
    const message = await next();
    expect(message.type).toBe('listening');
    const reply = await send(message.port!, { headers: { ...AUTH, ...JSON_HEADERS }, body: '{}' });
    expect(reply.status).toBe(201);
    child.send({ type: 'stop' });
    const [code] = await once(child, 'exit');
    expect(code).toBe(0);
    expect(output()).toContain('[crm simulado] POST /api/leads 201 L-1');
    expect(output()).not.toContain('t-1');
  });

  it('ignora SIGINT y termina con SIGTERM', async () => {
    const { child, next } = launch();
    child.send({ type: 'start', token: TOKEN, port: 0 });
    const { port } = await next();
    child.kill('SIGINT');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(child.exitCode).toBeNull();
    expect((await send(port!, { method: 'GET' })).status).toBe(404);
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    expect(code).toBe(0);
  });

  it('termina al perder el canal IPC', async () => {
    const { child, next } = launch();
    child.send({ type: 'start', token: TOKEN, port: 0 });
    await next();
    child.disconnect();
    const [code] = await once(child, 'exit');
    expect(code).toBe(0);
  });

  it('responde failed con el código del sistema si el puerto está ocupado', async () => {
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
    const { port } = holder.address() as { port: number };
    try {
      const { child, next } = launch();
      child.send({ type: 'start', token: TOKEN, port });
      expect(await next()).toEqual({ type: 'failed', code: 'EADDRINUSE' });
      const [code] = await once(child, 'exit');
      expect(code).not.toBe(0);
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  it('sin canal IPC dice cómo se arranca y termina con 2', async () => {
    const child = spawn(process.execPath, [CRM_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '' } });
    let output = '';
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const [code] = await once(child, 'exit');
    expect(code).toBe(2);
    expect(output).toContain('El CRM simulado se arranca con pnpm dev:demo.');
  });
});
