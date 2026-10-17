import http from 'node:http';

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
