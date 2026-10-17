import http from 'node:http';
import net from 'node:net';

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Una petición en bruto a la web (para poner el `Host` y el `Origin` que se quiera, como hace otra herramienta de la máquina). */
export function rawRequest(options: { method?: string; path: string; headers?: Record<string, string>; body?: string; port?: number }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: options.port ?? 3000, method: options.method ?? 'GET', path: options.path, headers: options.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

/**
 * Manda bytes en bruto por un socket y devuelve todo lo que contesta el servidor hasta que cierra o pasa `waitMs`. Para lo que
 * `http.request` no deja hacer: un `Host` duplicado o ausente, `HTTP/1.0`, `Expect`, `CONNECT` o un `upgrade`.
 */
export function rawBytes(text: string, options: { port?: number; waitMs?: number } = {}): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(options.port ?? 3000, '127.0.0.1');
    let received = '';
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('error', () => resolve(received));
    socket.on('close', () => resolve(received));
    socket.on('connect', () => socket.write(text, 'latin1'));
    setTimeout(() => {
      socket.destroy();
      resolve(received);
    }, options.waitMs ?? 1500);
  });
}

/** La línea de estado de una respuesta en bruto, o `''` si el servidor no contestó. */
export function statusLine(raw: string): string {
  return raw.split('\r\n')[0] ?? '';
}

/** La última línea de estado de una respuesta en bruto (tras un `100 Continue`, la definitiva). */
export function finalStatusLine(raw: string): string {
  const lines = raw.split('\r\n').filter((line) => /^HTTP\/1\.[01] \d{3}/.test(line));
  return lines[lines.length - 1] ?? '';
}

/** Una cabecera de una respuesta en bruto (sin distinguir mayúsculas), o `undefined`. */
export function headerOf(raw: string, name: string): string | undefined {
  const head = raw.split('\r\n\r\n')[0] ?? '';
  const line = head.split('\r\n').find((candidate) => candidate.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line?.slice(name.length + 1).trim();
}
