import { connect } from 'node:net';

export interface WireResponse {
  /** Código de estado, o `0` si la conexión se cerró sin una línea de estado. */
  status: number;
  /** Cabeceras de la respuesta, una por línea y sin procesar (`Nombre: valor`). */
  headers: string[];
  text: string;
  /** El cuerpo como JSON, o `undefined` si no lo es. */
  json: any;
}

/** Valor de una cabecera de la respuesta (sin distinguir mayúsculas), o `undefined`. */
export function wireHeader(response: WireResponse, name: string): string | undefined {
  const prefix = `${name.toLowerCase()}:`;
  const line = response.headers.find((header) => header.toLowerCase().startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

export interface WireOptions {
  /** Milisegundos máximos hasta que el servidor cierre la conexión (por defecto 15 000). */
  timeoutMs?: number;
}

/**
 * Escribe bytes en un socket TCP contra `127.0.0.1:<port>` y devuelve la primera respuesta HTTP. Controla al byte lo
 * que `http.request` y `supertest` normalizan: `Host` repetido, vacío o ausente, HTTP/1.0, `Content-Length` o
 * `Transfer-Encoding` a mano. Los errores de escritura (`EPIPE`, `ECONNRESET`: el servidor responde y cierra antes de
 * leer todo el cuerpo) no fallan la petición; se devuelve lo que llegó.
 *
 * @param port Puerto de loopback en el que escucha la API.
 * @param wire Bytes de la petición, ya con sus saltos de línea `\r\n`.
 * @param options Opciones de la conexión.
 */
export function wireRequest(port: number, wire: string | Uint8Array, options: WireOptions = {}): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('el servidor no cerró la conexión a tiempo'));
    }, options.timeoutMs ?? 15_000);
    socket.on('connect', () => socket.write(wire));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString('utf8');
      const split = text.indexOf('\r\n\r\n');
      const head = split === -1 ? text : text.slice(0, split);
      const [statusLine = '', ...headers] = head.split('\r\n');
      const body = split === -1 ? '' : text.slice(split + 4);
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        json = undefined;
      }
      resolve({ status: Number(statusLine.split(' ')[1] ?? 0) || 0, headers, text: body, json });
    });
  });
}

/**
 * Arma el texto de una petición HTTP.
 *
 * @param method Método.
 * @param path Ruta tal cual se envía.
 * @param headers Líneas de cabecera (`Host: localhost`), en el orden dado. No se añade `Host`.
 * @param body Cuerpo; añade `Content-Length` salvo que `headers` ya fije la longitud o `Transfer-Encoding`.
 * @param version Versión de HTTP (`1.1` por defecto).
 */
export function wireText(method: string, path: string, headers: string[], body?: string, version = '1.1'): string {
  const lines = [...headers, 'Connection: close'];
  if (body !== undefined && !lines.some((line) => /^(content-length|transfer-encoding):/i.test(line))) {
    lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
  }
  return `${method} ${path} HTTP/${version}\r\n${lines.join('\r\n')}\r\n\r\n${body ?? ''}`;
}
