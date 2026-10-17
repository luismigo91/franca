import http from 'node:http';
import type { Socket } from 'node:net';

/** Lo que registra la API simulada de cada petición que recibe. */
export interface RecordedRequest {
  method: string;
  /** Ruta y consulta tal como llegaron. */
  path: string;
  headers: http.IncomingHttpHeaders;
  /** Cabeceras en bruto, con el nombre como se escribió. */
  rawHeaders: string[];
  body: string;
}

export type FakeHandler = (request: RecordedRequest, response: http.ServerResponse, socket: Socket) => void | Promise<void>;

export interface FakeApi {
  readonly port: number;
  /** Dirección para `FRANCA_API_URL`. */
  readonly url: string;
  readonly requests: RecordedRequest[];
  /** Guion: qué responder (o `null` para volver a reenviar / al 404 por defecto). */
  respond(handler: FakeHandler | null): void;
  /** Reenvía cada petición a la API real en ese puerto (o `null`). El guion tiene prioridad. */
  forwardTo(port: number | null): void;
  /** «API parada»: deja de escuchar y corta las conexiones. */
  stop(): Promise<void>;
  /** Vuelve a escuchar en el mismo puerto. */
  start(): Promise<void>;
  /** Vacía el registro y el guion. */
  reset(): void;
  close(): Promise<void>;
}

/** Responde un JSON como lo haría la API. */
export function sendJson(response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(text)), ...headers });
  response.end(text);
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const FORWARDED_REQUEST_HEADERS = ['content-type', 'if-match'];
const SKIPPED_RESPONSE_HEADERS = new Set(['connection', 'transfer-encoding', 'keep-alive', 'date']);

function forward(port: number, recorded: RecordedRequest, response: http.ServerResponse): void {
  const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, Connection: 'close' };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = recorded.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  if (recorded.body !== '') headers['content-length'] = String(Buffer.byteLength(recorded.body));
  const upstream = http.request({ host: '127.0.0.1', port, method: recorded.method, path: recorded.path, headers }, (answer) => {
    const out: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(answer.headers)) {
      if (value !== undefined && !SKIPPED_RESPONSE_HEADERS.has(name)) out[name] = value;
    }
    response.writeHead(answer.statusCode ?? 502, out);
    answer.pipe(response);
  });
  upstream.on('error', () => response.destroy());
  upstream.end(recorded.body === '' ? undefined : recorded.body);
}

/**
 * Arranca la API simulada: un servidor `node:http` en `127.0.0.1` que registra cada petición y responde lo que diga el
 * guion, reenvía a la API real o contesta 404 `not_found`. La usan la integración de `pnpm check` y los E2E.
 *
 * @param options `port` para escuchar en uno concreto (0: el sistema elige).
 */
export async function startFakeApi(options: { port?: number } = {}): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  let handler: FakeHandler | null = null;
  let forwardPort: number | null = null;
  const sockets = new Set<Socket>();

  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    const recorded: RecordedRequest = { method: request.method ?? '', path: request.url ?? '', headers: request.headers, rawHeaders: request.rawHeaders, body };
    requests.push(recorded);
    if (handler) await handler(recorded, response, request.socket);
    else if (forwardPort !== null) forward(forwardPort, recorded, response);
    else sendJson(response, 404, { message: 'ruta no encontrada', error: 'not_found' });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  const stop = () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      if (!server.listening) resolve();
      else server.close(() => resolve());
    });

  await listen(options.port ?? 0);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('la API simulada no tiene puerto');
  const port = address.port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    respond(next) {
      handler = next;
    },
    forwardTo(next) {
      forwardPort = next;
    },
    stop,
    start: () => (server.listening ? Promise.resolve() : listen(port)),
    reset() {
      requests.length = 0;
      handler = null;
    },
    close: stop,
  };
}
