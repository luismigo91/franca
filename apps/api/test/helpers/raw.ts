import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  /** El cuerpo como JSON, o `undefined` si no lo es. */
  json: any;
}

export interface RawRequestOptions {
  method?: string;
  /** Ruta tal como se envía, sin que nadie la normalice (`/flows/%FF`). */
  path: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

/**
 * Petición HTTP/1.1 en bruto a `127.0.0.1:<port>`: controla la ruta, el `Host` y las cabeceras al byte, que
 * `supertest` normaliza.
 */
export function rawRequest(port: number, options: RawRequestOptions): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : Buffer.from(options.body);
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: { ...(body ? { 'content-length': String(body.length) } : {}), ...options.headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json });
        });
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}
