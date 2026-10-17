import { createServer, type Server, type Socket } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import {
  brotliCompressSync,
  createGzip,
  deflateRawSync,
  deflateSync,
  gzipSync,
} from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { httpChain, httpEvents } from './helpers/http-flows.js';
import { P, startWorld, type HttpWorld } from './helpers/http-world.js';
import { trustedAuthority } from './helpers/test-pki.js';

/** La tolerancia del entorno de los casos de tiempo (la del catálogo de conformidad del motor). */
const TOLERANCE_MS = 1500;
const VALUE_JSON = '{"v":"hola"}';

let sequence = 0;

type Script = (socket: Socket, requestHead: string) => void;

/** Un servidor TCP crudo en 127.0.0.1 que habla HTTP «a mano»: lee la cabecera de la petición y ejecuta el guion. */
class RawServer {
  private readonly sockets = new Set<Socket>();
  private readonly server: Server;
  readonly heads: string[] = [];
  port = 0;

  constructor(private readonly script: Script) {
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => this.sockets.delete(socket));
      let head = '';
      const onData = (chunk: Buffer): void => {
        head += chunk.toString('latin1');
        if (!head.includes('\r\n\r\n')) return;
        socket.off('data', onData);
        this.heads.push(head);
        this.script(socket, head);
      };
      socket.on('data', onData);
    });
  }

  async listen(): Promise<this> {
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    this.port = (this.server.address() as { port: number }).port;
    return this;
  }

  get open(): number {
    return this.sockets.size;
  }

  async close(): Promise<void> {
    this.sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** Flujo de una sola llamada `GET` que copia `/v` del cuerpo a una variable y la muestra en el mensaje final. */
function valueFlow(
  url: string,
  options: { timeoutMs?: number; retries?: number; id?: string } = {},
): any {
  return {
    specVersion: '0.1',
    id: options.id ?? 'valor-http',
    name: 'Valor http',
    variables: [{ name: 'v', type: 'string' }],
    start: 'h',
    nodes: [
      {
        id: 'h',
        type: 'http',
        request: { method: 'GET', url },
        timeoutMs: options.timeoutMs ?? 5000,
        retries: options.retries ?? 0,
        responseMap: [{ variable: 'v', pointer: '/v' }],
        next: 'fin',
        onError: 'fin',
      },
      {
        id: 'fin',
        type: 'end',
        outcome: 'fin',
        content: [{ kind: 'text', text: 'V={{v}}' }],
      },
    ],
  };
}

describe('QA salida http: respuestas hostiles (e2e)', () => {
  let world: HttpWorld;
  const raws: RawServer[] = [];

  beforeAll(async () => {
    world = await startWorld({
      variables: { FRANCA_HTTP_ALLOWED_DESTINATIONS: `${P}:80` },
    });
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await Promise.all(raws.splice(0).map((raw) => raw.close()));
    await world.reset();
  });

  /** Sirve `script` en el par virtual `P:80` y devuelve el resultado de un `GET http://api.example.com/`. */
  async function call(
    script: Script,
    options: { timeoutMs?: number } = {},
  ): Promise<{
    event: any;
    text: string | null;
    elapsedMs: number;
    raw: RawServer;
    body: any;
  }> {
    const raw = await new RawServer(script).listen();
    raws.push(raw);
    world.network.resolve('api.example.com', [P]);
    world.network.mapPair(P, 80, { port: raw.port } as never);
    const flow = valueFlow('http://api.example.com/', {
      ...options,
      id: `valor-http-${(sequence += 1)}`,
    });
    await world.ctx.publish(flow);
    const started = Date.now();
    const { body } = await world.ctx.start(flow.id);
    const elapsedMs = Date.now() - started;
    const message = body.events.find(
      (event: { type: string }) => event.type === 'message',
    );
    return {
      event: httpEvents(body)[0],
      text: message?.content?.[0]?.text ?? null,
      elapsedMs,
      raw,
      body,
    };
  }

  const reply = (
    socket: Socket,
    head: string,
    body = VALUE_JSON,
    extra = '',
  ): void => {
    socket.end(
      `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n${extra}\r\n${body}`,
    );
  };
  const NETWORK_ERROR = {
    type: 'http',
    nodeId: 'h',
    attempts: 1,
    status: null,
    error: 'network_error',
  };
  const OK = {
    type: 'http',
    nodeId: 'h',
    attempts: 1,
    status: 200,
    error: null,
  };

  describe('1xx, 101, status raros y framing', () => {
    it.each([
      [
        '103 Early Hints',
        'HTTP/1.1 103 Early Hints\r\nLink: </x>; rel=preload\r\n\r\n',
      ],
      ['100 Continue', 'HTTP/1.1 100 Continue\r\n\r\n'],
      ['tres 102 Processing', 'HTTP/1.1 102 Processing\r\n\r\n'.repeat(3)],
    ])(
      '%s antes de la respuesta final: gana la final',
      async (_label, interim) => {
        const result = await call((socket) => {
          socket.write(interim);
          setTimeout(
            () =>
              socket.end(
                `HTTP/1.1 200 OK\r\nContent-Length: ${VALUE_JSON.length}\r\nConnection: close\r\n\r\n${VALUE_JSON}`,
              ),
            20,
          );
        });
        expect(result.event).toEqual(OK);
        expect(result.text).toBe('V=hola');
      },
    );

    it('solo 1xx y cierre: network_error enseguida, sin esperar al plazo', async () => {
      const result = await call(
        (socket) => socket.end('HTTP/1.1 103 Early Hints\r\nLink: x\r\n\r\n'),
        { timeoutMs: 5000 },
      );
      expect(result.event).toEqual(NETWORK_ERROR);
      expect(result.elapsedMs).toBeLessThan(2500);
    });

    it('101 con cuerpo de protocolo después: network_error y la conexión se cierra', async () => {
      const result = await call((socket) =>
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nPAYLOAD-TRAS-EL-UPGRADE',
        ),
      );
      expect(result.event).toEqual(NETWORK_ERROR);
      expect(result.elapsedMs).toBeLessThan(2500);
      await expect.poll(() => result.raw.open, { timeout: 2000 }).toBe(0);
    });

    it.each([
      ['600', 'HTTP/1.1 600 X\r\nContent-Length: 0\r\n\r\n'],
      ['999', 'HTTP/1.1 999 X\r\nContent-Length: 0\r\n\r\n'],
      ['099', 'HTTP/1.1 099 X\r\nContent-Length: 0\r\n\r\n'],
      ['status de 4 cifras', 'HTTP/1.1 2000 X\r\nContent-Length: 0\r\n\r\n'],
      ['basura sin línea de estado', 'esto no es http\r\n\r\n'],
      ['sin versión', '200 OK\r\nContent-Length: 0\r\n\r\n'],
      ['status con signo', 'HTTP/1.1 +200 OK\r\nContent-Length: 0\r\n\r\n'],
    ])('%s: network_error y nunca http_host_error', async (_label, raw) => {
      const result = await call((socket) => socket.end(raw));
      expect(result.event).toEqual(NETWORK_ERROR);
      expect(result.body.conversation.status).toBe('ended');
      expect(result.body.conversation.error).toBeNull();
    });

    it('HTTP/2.0 en la línea de estado: el parser de Node lo lee como 200 sin cuerpo; no es una vía de ataque y la conversación termina', async () => {
      const result = await call((socket) =>
        socket.end('HTTP/2.0 200 OK\r\nContent-Length: 0\r\n\r\n'),
      );
      expect(result.body.conversation).toMatchObject({
        status: 'ended',
        error: null,
      });
      expect(result.text).toBe('V=');
    });

    it('Content-Length mayor que el cuerpo y cierre: network_error', async () => {
      const result = await call((socket) =>
        socket.end(
          `HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n${VALUE_JSON}`,
        ),
      );
      expect(result.event).toEqual(NETWORK_ERROR);
    });

    it('Content-Length menor que lo enviado: el cuerpo acaba donde dice la cabecera y lo que sobra se ignora', async () => {
      const result = await call((socket) => reply(socket, '', VALUE_JSON, ''));
      expect(result.event).toEqual(OK);
      const trailing = await call((socket) =>
        socket.end(
          `HTTP/1.1 200 OK\r\nContent-Length: ${VALUE_JSON.length}\r\nConnection: close\r\n\r\n${VALUE_JSON}{"v":"INYECTADO"}`,
        ),
      );
      expect(trailing.event).toEqual(OK);
      expect(trailing.text).toBe('V=hola');
    });

    it.each([
      [
        'Content-Length y Transfer-Encoding a la vez',
        'Content-Length: 12\r\nTransfer-Encoding: chunked\r\n',
      ],
      [
        'dos Content-Length distintos',
        'Content-Length: 12\r\nContent-Length: 13\r\n',
      ],
      ['Content-Length con signo', 'Content-Length: +12\r\n'],
      ['Content-Length negativo', 'Content-Length: -1\r\n'],
      [
        'Transfer-Encoding: chunked, chunked',
        'Transfer-Encoding: chunked, chunked\r\n',
      ],
      ['cabecera con salto de línea solo', 'X-A: b\nX-B: c\r\n'],
    ])(
      '%s (contrabando de peticiones): nunca se entrega un cuerpo ambiguo',
      async (_label, headers) => {
        const result = await call((socket) =>
          socket.end(
            `HTTP/1.1 200 OK\r\n${headers}Connection: close\r\n\r\n${VALUE_JSON}`,
          ),
        );
        // El parser estricto de Node rechaza la respuesta: con `insecureHTTPParser` se aceptaría una de las dos lecturas.
        expect(result.event).toEqual(NETWORK_ERROR);
      },
    );

    it('chunked bien formado con trailers se entrega entero', async () => {
      const result = await call((socket) =>
        socket.end(
          `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n6\r\n{"v":"\r\n6\r\nhola"}\r\n0\r\nX-Trailer: 1\r\n\r\n`,
        ),
      );
      expect(result.event).toEqual(OK);
      expect(result.text).toBe('V=hola');
    });

    it.each([
      ['tamaño de trozo no hexadecimal', 'zz\r\nabc\r\n0\r\n\r\n'],
      ['tamaño de trozo gigantesco', 'ffffffffffffffffff\r\nabc\r\n0\r\n\r\n'],
      ['trozo más corto que su tamaño', '20\r\nabc\r\n0\r\n\r\n'],
      ['sin trozo final y cierre', '3\r\nabc\r\n'],
    ])('chunked roto (%s): network_error', async (_label, chunks) => {
      const result = await call((socket) =>
        socket.end(
          `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${chunks}`,
        ),
      );
      expect(result.event).toEqual(NETWORK_ERROR);
    });

    it('HTTP/1.0 sin Content-Length: el cuerpo llega hasta el cierre', async () => {
      const result = await call((socket) =>
        socket.end(`HTTP/1.0 200 OK\r\n\r\n${VALUE_JSON}`),
      );
      expect(result.event).toEqual(OK);
      expect(result.text).toBe('V=hola');
    });

    it('el servidor no cierra tras un cuerpo completo: la respuesta no espera al cierre', async () => {
      const result = await call(
        (socket) =>
          socket.write(
            `HTTP/1.1 200 OK\r\nContent-Length: ${VALUE_JSON.length}\r\n\r\n${VALUE_JSON}`,
          ),
        { timeoutMs: 5000 },
      );
      expect(result.event).toEqual(OK);
      expect(result.elapsedMs).toBeLessThan(2000);
      // y la API cierra su lado: no quedan conexiones abiertas.
      await expect.poll(() => result.raw.open, { timeout: 3000 }).toBe(0);
    });

    it('un RST a mitad del cuerpo es network_error', async () => {
      const result = await call((socket) => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n{"v":');
        setTimeout(() => socket.resetAndDestroy(), 30);
      });
      expect(result.event).toEqual(NETWORK_ERROR);
    });
  });

  describe('lentitud y cabeceras sin fin', () => {
    it('cabeceras sin fin (sin CRLF) se cortan por el límite de 16 KiB, mucho antes del plazo', async () => {
      const result = await call(
        (socket) => {
          socket.write('HTTP/1.1 200 OK\r\nX-Sin-Fin: ');
          const timer = setInterval(() => socket.write('a'.repeat(8192)), 5);
          socket.on('close', () => clearInterval(timer));
        },
        { timeoutMs: 10_000 },
      );
      expect(result.event).toEqual(NETWORK_ERROR);
      expect(result.elapsedMs).toBeLessThan(3000);
      await expect.poll(() => result.raw.open, { timeout: 3000 }).toBe(0);
    });

    it('miles de cabeceras pequeñas que suman más de 16 KiB se rechazan; 100 cabeceras que caben se aceptan', async () => {
      const many = await call((socket) => {
        const headers = Array.from(
          { length: 3000 },
          (_unused, index) => `X-${index}: v`,
        ).join('\r\n');
        socket.end(
          `HTTP/1.1 200 OK\r\n${headers}\r\nContent-Length: 0\r\n\r\n`,
        );
      });
      expect(many.event).toEqual(NETWORK_ERROR);
      const few = await call((socket) => {
        const headers = Array.from(
          { length: 100 },
          (_unused, index) => `X-${index}: v`,
        ).join('\r\n');
        socket.end(
          `HTTP/1.1 200 OK\r\n${headers}\r\nContent-Length: ${VALUE_JSON.length}\r\n\r\n${VALUE_JSON}`,
        );
      });
      expect(few.event).toEqual(OK);
    });

    it('cabeceras de respuesta que gotean un byte cada 40 ms hasta vencer el plazo: timeout a tiempo', async () => {
      const result = await call(
        (socket) => {
          const bytes = Buffer.from(
            'HTTP/1.1 200 OK\r\nX-Lento: ' + 'a'.repeat(4000),
          );
          let index = 0;
          const timer = setInterval(() => {
            if (socket.destroyed || index >= bytes.length)
              return clearInterval(timer);
            socket.write(bytes.subarray(index, ++index));
          }, 40);
          socket.on('close', () => clearInterval(timer));
        },
        { timeoutMs: 700 },
      );
      expect(result.event).toEqual({
        type: 'http',
        nodeId: 'h',
        attempts: 1,
        status: null,
        error: 'timeout',
      });
      expect(result.elapsedMs).toBeGreaterThanOrEqual(650);
      expect(result.elapsedMs).toBeLessThanOrEqual(700 + TOLERANCE_MS);
      await expect.poll(() => result.raw.open, { timeout: 3000 }).toBe(0);
    });

    it('cuerpo que gotea un byte cada 40 ms con Content-Length mentiroso (1000): timeout a tiempo y conexión cerrada', async () => {
      const result = await call(
        (socket) => {
          socket.write('HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n');
          const timer = setInterval(() => socket.write('x'), 40);
          socket.on('close', () => clearInterval(timer));
        },
        { timeoutMs: 700 },
      );
      expect(result.event).toEqual({
        type: 'http',
        nodeId: 'h',
        attempts: 1,
        status: null,
        error: 'timeout',
      });
      expect(result.elapsedMs).toBeLessThanOrEqual(700 + TOLERANCE_MS);
      await expect.poll(() => result.raw.open, { timeout: 3000 }).toBe(0);
    });

    it('chunked al que nunca llega el trozo final: timeout y no una respuesta parcial', async () => {
      const result = await call(
        (socket) =>
          socket.write(
            'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n{"v":"\r\n',
          ),
        { timeoutMs: 600 },
      );
      expect(result.event).toEqual({
        type: 'http',
        nodeId: 'h',
        attempts: 1,
        status: null,
        error: 'timeout',
      });
      expect(result.text).toBe('V=');
    });
  });

  describe('cuerpos grandes y compresión', () => {
    const MIB = 1_048_576;
    const send =
      (body: Buffer, headers = ''): Script =>
      (socket) => {
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n${headers}Connection: close\r\n\r\n`,
        );
        socket.end(body);
      };
    const eventOf = (result: { event: any }) => ({
      status: result.event.status,
      error: result.event.error,
    });

    it('exactamente 1 MiB identity se entrega entero; 1 MiB + 1 byte es response_too_large', async () => {
      expect(eventOf(await call(send(Buffer.alloc(MIB, 0x20))))).toMatchObject({
        status: 200,
      });
      const over = await call(send(Buffer.alloc(MIB + 1, 0x20)));
      expect(over.event).toEqual({
        type: 'http',
        nodeId: 'h',
        attempts: 1,
        status: null,
        error: 'response_too_large',
      });
    });

    it('Content-Length declarado enorme se rechaza sin leer el cuerpo', async () => {
      const result = await call((socket) => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 99999999999\r\n\r\n');
        const timer = setInterval(() => socket.write('x'.repeat(65_536)), 5);
        socket.on('close', () => clearInterval(timer));
      });
      expect(result.event.error).toBe('response_too_large');
      expect(result.elapsedMs).toBeLessThan(2500);
      await expect.poll(() => result.raw.open, { timeout: 3000 }).toBe(0);
    });

    it('chunked sin fin de identity: se corta en 1 MiB, la API sigue y cierra la conexión', async () => {
      const result = await call((socket) => {
        socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n');
        const piece = Buffer.from(
          `${(4096).toString(16)}\r\n${'a'.repeat(4096)}\r\n`,
        );
        const timer = setInterval(() => socket.write(piece), 1);
        socket.on('close', () => clearInterval(timer));
      });
      expect(result.event.error).toBe('response_too_large');
      expect(result.elapsedMs).toBeLessThan(4000);
      await expect.poll(() => result.raw.open, { timeout: 3000 }).toBe(0);
    });

    it.each([
      ['gzip', 'gzip', (raw: Buffer) => gzipSync(raw)],
      ['x-gzip', 'x-gzip', (raw: Buffer) => gzipSync(raw)],
      ['GZIP en mayúsculas', 'GZIP', (raw: Buffer) => gzipSync(raw)],
      [
        'deflate con cabecera zlib',
        'deflate',
        (raw: Buffer) => deflateSync(raw),
      ],
      [
        'deflate crudo (RFC 1951)',
        'deflate',
        (raw: Buffer) => deflateRawSync(raw),
      ],
      ['br', 'br', (raw: Buffer) => brotliCompressSync(raw)],
      [
        'gzip de dos miembros concatenados',
        'gzip',
        (raw: Buffer) =>
          Buffer.concat([
            gzipSync(raw.subarray(0, 6)),
            gzipSync(raw.subarray(6)),
          ]),
      ],
    ])(
      'se descomprime %s y se entrega el JSON',
      async (_label, encoding, compress) => {
        const result = await call(
          send(
            compress(Buffer.from(VALUE_JSON)),
            `Content-Encoding: ${encoding}\r\n`,
          ),
        );
        expect(result.event).toEqual(OK);
        expect(result.text).toBe('V=hola');
      },
    );

    it.each([
      ['gzip', 'gzip', (raw: Buffer) => gzipSync(raw)],
      ['deflate', 'deflate', (raw: Buffer) => deflateSync(raw)],
      ['br', 'br', (raw: Buffer) => brotliCompressSync(raw)],
    ])(
      '%s: exactamente 1 MiB descomprimido pasa y 1 MiB + 1 es response_too_large',
      async (_label, encoding, compress) => {
        expect(
          eventOf(
            await call(
              send(
                compress(Buffer.alloc(MIB, 0x20)),
                `Content-Encoding: ${encoding}\r\n`,
              ),
            ),
          ),
        ).toMatchObject({ status: 200 });
        const over = await call(
          send(
            compress(Buffer.alloc(MIB + 1, 0x20)),
            `Content-Encoding: ${encoding}\r\n`,
          ),
        );
        expect(over.event.error).toBe('response_too_large');
      },
    );

    it.each([
      ['gzip truncado', 'gzip', (raw: Buffer) => gzipSync(raw).subarray(0, 12)],
      [
        'gzip con CRC corrompido',
        'gzip',
        (raw: Buffer) => {
          const z = Buffer.from(gzipSync(raw));
          z[z.length - 5] ^= 0xff;
          return z;
        },
      ],
      [
        'deflate truncado',
        'deflate',
        (raw: Buffer) => deflateSync(raw).subarray(0, 6),
      ],
      [
        'br truncado',
        'br',
        (raw: Buffer) => brotliCompressSync(raw).subarray(0, 4),
      ],
      ['gzip que no es gzip', 'gzip', (raw: Buffer) => raw],
      [
        'br que no es brotli',
        'br',
        () => Buffer.from('{"v":"hola"}garbage-garbage-garbage'),
      ],
    ])(
      '%s: network_error (nunca un cuelgue ni un http_host_error)',
      async (_label, encoding, corrupt) => {
        const result = await call(
          send(
            Buffer.from(corrupt(Buffer.from(VALUE_JSON))),
            `Content-Encoding: ${encoding}\r\n`,
          ),
        );
        expect(result.event).toEqual(NETWORK_ERROR);
        expect(result.body.conversation.error).toBeNull();
      },
    );

    it.each([
      ['gzip, gzip', 'gzip, gzip'],
      ['gzip, identity', 'gzip, identity'],
      ['identity', 'identity'],
      ['zstd', 'zstd'],
      ['compress', 'compress'],
    ])(
      'Content-Encoding %j no se descomprime: llega el cuerpo tal cual',
      async (_label, encoding) => {
        const result = await call(
          send(Buffer.from(VALUE_JSON), `Content-Encoding: ${encoding}\r\n`),
        );
        expect(result.event).toEqual(OK);
        expect(result.text).toBe('V=hola');
      },
    );

    it('un 204 con Content-Encoding: gzip y sin cuerpo es válido', async () => {
      const result = await call((socket) =>
        socket.end('HTTP/1.1 204 No Content\r\nContent-Encoding: gzip\r\n\r\n'),
      );
      expect(result.event).toMatchObject({ status: 204 });
    });

    /** Una bomba: `decompressedMiB` MiB de ceros comprimidos en streaming (nunca entera en memoria). */
    async function bomb(
      encoding: 'gzip' | 'br',
      decompressedMiB: number,
    ): Promise<Buffer> {
      const { createBrotliCompress, constants } = await import('node:zlib');
      const stream =
        encoding === 'gzip'
          ? createGzip({ level: 9 })
          : createBrotliCompress({
              params: {
                [constants.BROTLI_PARAM_QUALITY]: 5,
                [constants.BROTLI_PARAM_SIZE_HINT]: decompressedMiB * MIB,
              },
            });
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      const done = new Promise<void>((resolve) =>
        stream.on('end', () => resolve()),
      );
      const zeros = Buffer.alloc(MIB);
      for (let i = 0; i < decompressedMiB; i++)
        if (!stream.write(zeros))
          await new Promise<void>((resolve) =>
            stream.once('drain', () => resolve()),
          );
      stream.end();
      await done;
      return Buffer.concat(chunks);
    }

    it.each(['gzip', 'br'] as const)(
      'bomba %s de 512 MiB descomprimidos: response_too_large enseguida y sin disparar la memoria',
      async (encoding) => {
        const compressed = await bomb(encoding, 512);
        expect(compressed.length).toBeLessThan(2 * MIB);
        let peak = 0;
        const base = process.memoryUsage().rss;
        const sampler = setInterval(
          () => (peak = Math.max(peak, process.memoryUsage().rss - base)),
          5,
        );
        try {
          const result = await call(
            send(compressed, `Content-Encoding: ${encoding}\r\n`),
          );
          expect(result.event).toEqual({
            type: 'http',
            nodeId: 'h',
            attempts: 1,
            status: null,
            error: 'response_too_large',
          });
          expect(result.elapsedMs).toBeLessThan(5000);
        } finally {
          clearInterval(sampler);
        }
        // El tope es 1 MiB: con holgura generosa para el motor de zlib y el GC, muy por debajo de los 512 MiB de la bomba.
        expect(peak).toBeLessThan(160 * MIB);
      },
    );
  });

  describe('TLS hostil', () => {
    /** `GET https://api.example.com/` contra un servidor crudo en `P:443` que no habla TLS como debe. */
    async function callTls(
      script: Script,
      options: {
        timeoutMs?: number;
        retries?: number;
        method?: 'GET' | 'POST';
      } = {},
    ): Promise<{ events: any[]; elapsedMs: number; raw: RawServer }> {
      const raw = await new RawServer(script).listen();
      raws.push(raw);
      world.network.resolve('api.example.com', [P]);
      world.network.mapPair(P, 443, { port: raw.port } as never);
      const flow = httpChain(
        [
          {
            method: options.method ?? 'GET',
            url: 'https://api.example.com/',
            ...(options.method === 'POST' ? { body: { a: 1 } } : {}),
            timeoutMs: options.timeoutMs ?? 5000,
            retries: options.retries ?? 0,
          },
        ],
        `tls-hostil-${(sequence += 1)}`,
      );
      await world.ctx.publish(flow);
      const started = Date.now();
      const { body } = await world.ctx.start(flow.id);
      return { events: httpEvents(body), elapsedMs: Date.now() - started, raw };
    }

    // El RawServer espera una cabecera HTTP completa antes de ejecutar el guion: los guiones TLS tienen su propio servidor.
    async function tlsGarbage(
      respond: (socket: Socket) => void,
      options: Parameters<typeof callTls>[1] = {},
    ) {
      const server = createServer((socket) => {
        socket.on('error', () => undefined);
        socket.once('data', () => respond(socket));
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const port = (server.address() as { port: number }).port;
      world.network.resolve('api.example.com', [P]);
      world.network.mapPair(P, 443, { port } as never);
      const flow = httpChain(
        [
          {
            method: options.method ?? 'GET',
            url: 'https://api.example.com/',
            ...(options.method === 'POST' ? { body: { a: 1 } } : {}),
            timeoutMs: options.timeoutMs ?? 5000,
            retries: options.retries ?? 0,
          },
        ],
        `tls-garbage-${(sequence += 1)}`,
      );
      await world.ctx.publish(flow);
      const started = Date.now();
      try {
        const { body } = await world.ctx.start(flow.id);
        return { events: httpEvents(body), elapsedMs: Date.now() - started };
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    it('un servidor que contesta HTTP en claro a un ClientHello: network_error sin enviar, y un POST se reintenta (nada salió)', async () => {
      const { events, elapsedMs } = await tlsGarbage(
        (socket) =>
          socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'),
        { method: 'POST', retries: 2 },
      );
      expect(events).toEqual([
        {
          type: 'http',
          nodeId: 'h1',
          attempts: 3,
          status: null,
          error: 'network_error',
        },
      ]);
      expect(elapsedMs).toBeLessThan(4000);
    });

    it('un servidor que acepta el TCP y calla (handshake colgado) vence por el plazo y la conexión se cierra', async () => {
      const sockets = new Set<Socket>();
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on('error', () => undefined);
        socket.on('close', () => sockets.delete(socket));
        // Sin leer, Node no llega a ver el cierre del cliente: consume el ClientHello y calla.
        socket.resume();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      try {
        world.network.resolve('api.example.com', [P]);
        world.network.mapPair(P, 443, {
          port: (server.address() as { port: number }).port,
        } as never);
        const flow = httpChain(
          [
            {
              method: 'GET',
              url: 'https://api.example.com/',
              timeoutMs: 700,
              retries: 0,
            },
          ],
          `tls-callado-${(sequence += 1)}`,
        );
        await world.ctx.publish(flow);
        const started = Date.now();
        const { body } = await world.ctx.start(flow.id);
        const elapsed = Date.now() - started;
        expect(httpEvents(body)).toEqual([
          {
            type: 'http',
            nodeId: 'h1',
            attempts: 1,
            status: null,
            error: 'timeout',
          },
        ]);
        expect(elapsed).toBeGreaterThanOrEqual(650);
        expect(elapsed).toBeLessThanOrEqual(700 + TOLERANCE_MS);
        await expect.poll(() => sockets.size, { timeout: 3000 }).toBe(0);
      } finally {
        sockets.forEach((socket) => socket.destroy());
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('bytes aleatorios en lugar de un ServerHello: network_error y la conexión se cierra', async () => {
      const { events } = await tlsGarbage((socket) =>
        socket.end(
          Buffer.from(
            Array.from({ length: 200 }, (_unused, index) => (index * 37) % 256),
          ),
        ),
      );
      expect(events).toEqual([
        {
          type: 'http',
          nodeId: 'h1',
          attempts: 1,
          status: null,
          error: 'network_error',
        },
      ]);
    });

    it('el nombre del servidor (SNI) es el host de la url y no la dirección a la que se conecta', async () => {
      const names: (string | undefined)[] = [];
      const leaf = trustedAuthority.issue('api.example.com');
      const server = createTlsServer(
        {
          key: leaf.key,
          cert: leaf.certificate,
          SNICallback: (servername, callback) => {
            names.push(servername);
            callback(null, undefined);
          },
        },
        (socket) => {
          socket.on('error', () => undefined);
          socket.once('data', () =>
            socket.end(
              'HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
            ),
          );
        },
      );
      server.on('tlsClientError', () => undefined);
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      try {
        world.network.resolve('api.example.com', [P]);
        world.network.mapPair(P, 443, {
          port: (server.address() as { port: number }).port,
        } as never);
        const flow = httpChain(
          [{ method: 'GET', url: 'https://api.example.com/', retries: 0 }],
          `tls-sni-${(sequence += 1)}`,
        );
        await world.ctx.publish(flow);
        const { body } = await world.ctx.start(flow.id);
        expect(httpEvents(body)).toEqual([
          { type: 'http', nodeId: 'h1', attempts: 1, status: 200, error: null },
        ]);
        expect(names).toEqual(['api.example.com']);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('carga', () => {
    it('30 conversaciones a la vez contra servidores que se cuelgan vencen todas por su plazo y no dejan ninguna conexión abierta', async () => {
      world.network.resolve('api.example.com', [P]);
      const server = await world.serveAt(
        P,
        443,
        { kind: 'stall-headers' },
        { tls: { hostname: 'api.example.com', authority: 'trusted' } },
      );
      const flow = httpChain(
        [
          {
            method: 'GET',
            url: 'https://api.example.com/',
            timeoutMs: 600,
            retries: 0,
          },
        ],
        `carga-${(sequence += 1)}`,
      );
      await world.ctx.publish(flow);
      const started = Date.now();
      const results = await Promise.all(
        Array.from({ length: 30 }, () => world.ctx.start(flow.id)),
      );
      expect(Date.now() - started).toBeLessThan(600 + 4000);
      for (const { body } of results)
        expect(httpEvents(body)).toEqual([
          {
            type: 'http',
            nodeId: 'h1',
            attempts: 1,
            status: null,
            error: 'timeout',
          },
        ]);
      expect(server.received()).toHaveLength(30);
      await expect
        .poll(() => server.openConnections(), { timeout: 5000 })
        .toBe(0);
    });
  });
});
