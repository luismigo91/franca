import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ADVANCE_TIMEOUT_MS, MAX_API_RESPONSE_BYTES, READ_TIMEOUT_MS } from '@/config/limits';
import { parseApiUrl } from '@/server/config/api-url.mjs';
import { sendToApi } from '@/server/api/transport';
import { sendJson, startFakeApi, type FakeApi } from '../../../tests/helpers/fake-api';

const open: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of open.splice(0)) await close();
});

async function fake(): Promise<FakeApi> {
  const api = await startFakeApi();
  open.push(() => api.close());
  return api;
}

/** Un servidor TCP en bruto que responde lo que se le diga con los bytes exactos. */
async function raw(onConnection: (socket: net.Socket) => void, host = '127.0.0.1'): Promise<number> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  open.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return (server.address() as net.AddressInfo).port;
}

const target = (port: number, host = '127.0.0.1') => parseApiUrl(`http://${host}:${port}`);

describe('transport', () => {
  it('manda exactamente Host, Connection: close, Content-Type, Content-Length e If-Match, y nada más', async () => {
    const api = await fake();
    api.respond((_request, response) => sendJson(response, 200, { ok: true }));
    const result = await sendToApi({ method: 'POST', path: '/conversations/x/inputs', body: '{"input":{"text":" Ana "}}', ifMatch: '"3"', timeoutMs: 5000 }, target(api.port));
    expect(result).toMatchObject({ kind: 'response', status: 200 });
    const [request] = api.requests;
    expect(request).toMatchObject({ method: 'POST', path: '/conversations/x/inputs', body: '{"input":{"text":" Ana "}}' });
    expect(request!.headers).toEqual({
      host: `127.0.0.1:${api.port}`,
      connection: 'close',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength('{"input":{"text":" Ana "}}')),
      'if-match': '"3"',
    });
    expect(request!.rawHeaders.filter((_, index) => index % 2 === 0)).toEqual(['Host', 'Connection', 'Content-Type', 'Content-Length', 'If-Match']);
  });

  it('un GET sin cuerpo no lleva Content-Type ni If-Match', async () => {
    const api = await fake();
    api.respond((_request, response) => sendJson(response, 200, { ok: true }));
    await sendToApi({ method: 'GET', path: '/flows?published=true&limit=20&offset=0', timeoutMs: 5000 }, target(api.port));
    expect(Object.keys(api.requests[0]!.headers).sort()).toEqual(['connection', 'host']);
  });

  it('el Host es el de FRANCA_API_URL, también con localhost', async () => {
    const api = await fake();
    api.respond((_request, response) => sendJson(response, 200, {}));
    await sendToApi({ method: 'GET', path: '/x', timeoutMs: 5000 }, target(api.port, 'localhost'));
    expect(api.requests[0]!.headers.host).toBe(`localhost:${api.port}`);
  });

  it('un 204 trae body null', async () => {
    const api = await fake();
    api.respond((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    expect(await sendToApi({ method: 'DELETE', path: '/conversations/x', timeoutMs: 5000 }, target(api.port))).toEqual({ kind: 'response', status: 204, body: null });
  });

  it('devuelve los bytes del cuerpo sin interpretarlos', async () => {
    const api = await fake();
    api.respond((_request, response) => {
      response.writeHead(409, { 'Content-Type': 'text/plain' });
      response.end('no es json ñ');
    });
    const result = await sendToApi({ method: 'GET', path: '/x', timeoutMs: 5000 }, target(api.port));
    expect(result.kind === 'response' && Buffer.from(result.body!).toString('utf8')).toBe('no es json ñ');
    expect(result).toMatchObject({ kind: 'response', status: 409 });
  });

  it('los plazos de producción son al menos 180 s para un avance y 15 s para el resto', () => {
    expect(ADVANCE_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
    expect(READ_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
  });

  it('el plazo se agota: unreachable', async () => {
    const api = await fake();
    api.respond(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await sendToApi({ method: 'GET', path: '/x', timeoutMs: 150 }, target(api.port))).toEqual({ kind: 'unreachable' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('un puerto cerrado es unreachable', async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as net.AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    expect(await sendToApi({ method: 'GET', path: '/x', timeoutMs: 2000 }, target(port))).toEqual({ kind: 'unreachable' });
  });

  it('un cierre sin respuesta es unreachable', async () => {
    const port = await raw((socket) => socket.once('data', () => socket.destroy()));
    expect(await sendToApi({ method: 'GET', path: '/x', timeoutMs: 2000 }, target(port))).toEqual({ kind: 'unreachable' });
  });

  it('un cierre a medio cuerpo es unreachable (la respuesta perdida)', async () => {
    const port = await raw((socket) =>
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{"conversation":');
        setTimeout(() => socket.destroy(), 20);
      }),
    );
    expect(await sendToApi({ method: 'POST', path: '/x', body: '{}', timeoutMs: 2000 }, target(port))).toEqual({ kind: 'unreachable' });
  });

  it('un 101 Switching Protocols cierra sin response y es unreachable', async () => {
    const port = await raw((socket) =>
      socket.once('data', () => socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')),
    );
    expect(await sendToApi({ method: 'GET', path: '/x', timeoutMs: 2000 }, target(port))).toEqual({ kind: 'unreachable' });
  });

  it('un status fuera de 200-599 es invalid', async () => {
    const port = await raw((socket) =>
      socket.once('data', () => socket.end('HTTP/1.1 600 Raro\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}')),
    );
    expect(await sendToApi({ method: 'GET', path: '/x', timeoutMs: 2000 }, target(port))).toEqual({ kind: 'invalid' });
  });

  it('una respuesta de más de 32 MiB es invalid', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    const port = await raw((socket) =>
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n');
        let sent = 0;
        const pump = () => {
          while (sent <= MAX_API_RESPONSE_BYTES + 1024 * 1024) {
            sent += chunk.length;
            if (!socket.write(chunk)) {
              socket.once('drain', pump);
              return;
            }
          }
          socket.end();
        };
        pump();
      }),
    );
    expect(await sendToApi({ method: 'GET', path: '/x', timeoutMs: 20_000 }, target(port))).toEqual({ kind: 'invalid' });
  });

  it('localhost conecta a loopback en IPv4', async () => {
    const api = await fake();
    api.respond((_request, response) => sendJson(response, 200, { ok: true }));
    expect(await sendToApi({ method: 'GET', path: '/x', timeoutMs: 5000 }, target(api.port, 'localhost'))).toMatchObject({ kind: 'response', status: 200 });
  });

  it('localhost conecta a loopback también si la API solo escucha en ::1', async (context) => {
    const server = http.createServer((request, response) => {
      request.resume();
      sendJson(response, 200, { via: 'ipv6' });
    });
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(0, '::1', () => resolve(true));
    });
    if (!listening) {
      context.skip();
      return;
    }
    open.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as net.AddressInfo;
    const result = await sendToApi({ method: 'GET', path: '/x', timeoutMs: 5000 }, target(port, 'localhost'));
    expect(result).toMatchObject({ kind: 'response', status: 200 });
  });

  it('no usa el agente global: ni keep-alive ni conexiones reutilizadas', async () => {
    const api = await fake();
    api.respond((request, response) => sendJson(response, 200, { port: request.headers.connection }));
    const first = await sendToApi({ method: 'GET', path: '/a', timeoutMs: 5000 }, target(api.port));
    const second = await sendToApi({ method: 'GET', path: '/b', timeoutMs: 5000 }, target(api.port));
    expect([first.kind, second.kind]).toEqual(['response', 'response']);
    expect(api.requests.map((request) => request.headers.connection)).toEqual(['close', 'close']);
    expect(http.globalAgent.sockets).toEqual({});
    expect(http.globalAgent.freeSockets).toEqual({});
  });
});
