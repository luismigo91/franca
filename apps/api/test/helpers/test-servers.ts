import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { brotliCompressSync, constants, createBrotliCompress, createDeflate, createGzip, deflateSync, gzipSync } from 'node:zlib';
import type { ReceivedRequest, ServerBehaviour } from '@franca/engine/conformance';
import { trustedAuthority, untrustedAuthority } from './test-pki.js';

export type { ReceivedRequest, ServerBehaviour };

/** Lo que un servidor del test puede hacer: los comportamientos del motor más los de los escenarios de la API. */
export type Behaviour =
  | ServerBehaviour
  /** Lee la petición entera y cierra la conexión sin responder. */
  | { kind: 'read-and-close' }
  /** Responde `101 Switching Protocols` en crudo. */
  | { kind: 'switching-protocols' }
  /** Acepta la petición y responde `200` con las cabeceras recibidas como cuerpo JSON. */
  | { kind: 'echo-headers' };

export interface TlsOptions {
  /** Nombre para el que se emite el certificado del servidor. */
  readonly hostname: string;
  /** `trusted` (la que acepta la red del test) o `untrusted`. */
  readonly authority: 'trusted' | 'untrusted';
}

export interface StartOptions {
  readonly tls?: TlsOptions;
}

export interface TestServer {
  /** Puerto real, en `127.0.0.1`. */
  readonly port: number;
  /** Peticiones HTTP recibidas, en orden (una vez leído su cuerpo). */
  received(): readonly ReceivedRequest[];
  /** Conexiones TCP aceptadas (también las que no llegaron a enviar una petición HTTP, como un TLS fallido). */
  connections(): number;
  /** Conexiones TCP que siguen abiertas ahora mismo. */
  openConnections(): number;
  close(): Promise<void>;
}

const CHUNK = Buffer.alloc(16_384, 'a');

/** Puertos reales (en `127.0.0.1`) de los servidores del test que siguen escuchando: ningún par virtual puede coincidir con uno. */
const REAL_PORTS = new Set<number>();

/** `true` si `port` es el puerto real de un servidor del test que sigue escuchando. */
export const isRealServerPort = (port: number): boolean => REAL_PORTS.has(port);

/** Descarta el rechazo de una escritura en un socket que el cliente ya cerró. */
const ignore = (): void => undefined;

/** Escribe sin fin hasta que el cliente cierra la conexión. */
async function writeEndlessly(target: NodeJS.WritableStream, isClosed: () => boolean, afterWrite: () => void = ignore): Promise<void> {
  while (!isClosed()) {
    const accepted = target.write(CHUNK);
    afterWrite();
    if (!accepted) {
      await new Promise<void>((resolve) => {
        const done = (): void => resolve();
        target.once('drain', done);
        target.once('close', done);
      });
    } else {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

function respondWith(behaviour: Behaviour, request: IncomingMessage, response: ServerResponse, timers: Set<NodeJS.Timeout>): void {
  const closed = (): boolean => response.destroyed || response.writableEnded || (request.socket?.destroyed ?? true);
  switch (behaviour.kind) {
    case 'respond': {
      response.writeHead(behaviour.status, behaviour.headers);
      response.end(behaviour.body ?? '');
      return;
    }
    case 'redirect': {
      response.writeHead(behaviour.status, { location: behaviour.location });
      response.end();
      return;
    }
    case 'set-cookie': {
      response.writeHead(200, { 'set-cookie': behaviour.cookie });
      response.end('ok');
      return;
    }
    case 'stall-headers':
      return;
    case 'stall-body': {
      response.writeHead(200, { 'content-length': '1000' });
      response.write('x');
      return;
    }
    case 'drip-body': {
      response.writeHead(200);
      const timer = setInterval(() => {
        if (closed()) clearInterval(timer);
        else response.write('x');
      }, behaviour.intervalMs);
      timers.add(timer);
      return;
    }
    case 'endless-body': {
      if (behaviour.encoding === 'identity' || behaviour.encoding === 'x-franca-test') {
        response.writeHead(200, behaviour.encoding === 'identity' ? {} : { 'content-encoding': behaviour.encoding });
        void writeEndlessly(response, closed).catch(ignore);
        return;
      }
      response.writeHead(200, { 'content-encoding': behaviour.encoding });
      // Un flujo infinito de bytes iguales comprimido: pocos bytes de red por muchos descomprimidos.
      const stream =
        behaviour.encoding === 'gzip' ? createGzip() : behaviour.encoding === 'deflate' ? createDeflate() : createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 1 } });
      stream.on('error', ignore);
      stream.pipe(response);
      void writeEndlessly(stream, closed, () => stream.flush()).catch(ignore);
      return;
    }
    case 'compressed-body': {
      const raw = Buffer.alloc(behaviour.decompressedBytes, 'a');
      const body = behaviour.encoding === 'gzip' ? gzipSync(raw) : behaviour.encoding === 'deflate' ? deflateSync(raw) : brotliCompressSync(raw);
      response.writeHead(200, { 'content-encoding': behaviour.encoding, 'content-length': String(body.length) });
      response.end(body);
      return;
    }
    case 'read-and-close': {
      request.socket.destroy();
      return;
    }
    case 'switching-protocols': {
      request.socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: x-franca\r\nConnection: Upgrade\r\n\r\n');
      request.socket.end();
      return;
    }
    case 'echo-headers': {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.headers));
      return;
    }
  }
}

/**
 * Servidores reales del test en `127.0.0.1:0`, `http` o `https` (con un certificado de la PKI en memoria). Cada petición se
 * responde con el comportamiento que toca: uno fijo, o el i-ésimo de una secuencia (el último se repite).
 */
export class TestServers {
  private readonly started: { server: Server; sockets: Set<Socket>; timers: Set<NodeJS.Timeout> }[] = [];

  /**
   * @param behaviours Un comportamiento, o una secuencia (la petición nº i recibe el i-ésimo; el último se repite).
   * @param options TLS opcional.
   * @returns El servidor ya escuchando.
   */
  async start(behaviours: Behaviour | readonly Behaviour[], options: StartOptions = {}): Promise<TestServer> {
    const sequence = Array.isArray(behaviours) ? (behaviours as readonly Behaviour[]) : [behaviours as Behaviour];
    const received: ReceivedRequest[] = [];
    const sockets = new Set<Socket>();
    const timers = new Set<NodeJS.Timeout>();
    let connections = 0;
    const handler = (request: IncomingMessage, response: ServerResponse): void => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('error', ignore);
      response.on('error', ignore);
      request.on('end', () => {
        received.push({
          method: request.method ?? '',
          path: request.url ?? '',
          headers: Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : String(value)])),
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const behaviour = sequence[Math.min(received.length - 1, sequence.length - 1)]!;
        respondWith(behaviour, request, response, timers);
      });
    };
    let server: Server;
    if (options.tls) {
      const authority = options.tls.authority === 'trusted' ? trustedAuthority : untrustedAuthority;
      const leaf = authority.issue(options.tls.hostname);
      server = createHttpsServer({ key: leaf.key, cert: leaf.certificate }, handler);
    } else {
      server = createHttpServer(handler);
    }
    server.on('connection', (socket: Socket) => {
      connections++;
      sockets.add(socket);
      socket.on('error', ignore);
      socket.on('close', () => sockets.delete(socket));
    });
    server.on('tlsClientError', ignore);
    server.on('clientError', (_error, socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.started.push({ server, sockets, timers });
    const port = (server.address() as AddressInfo).port;
    REAL_PORTS.add(port);
    return {
      port,
      received: () => received,
      connections: () => connections,
      openConnections: () => sockets.size,
      close: () => this.closeOne({ server, sockets, timers }),
    };
  }

  private async closeOne(entry: { server: Server; sockets: Set<Socket>; timers: Set<NodeJS.Timeout> }): Promise<void> {
    REAL_PORTS.delete((entry.server.address() as AddressInfo | null)?.port ?? -1);
    entry.timers.forEach((timer) => clearInterval(timer));
    entry.timers.clear();
    for (const socket of entry.sockets) socket.destroy();
    await new Promise<void>((resolve) => (entry.server.listening ? entry.server.close(() => resolve()) : resolve()));
  }

  /** Cierra todos los servidores y sus conexiones. */
  async closeAll(): Promise<void> {
    const entries = this.started.splice(0);
    await Promise.all(entries.map((entry) => this.closeOne(entry)));
  }
}
