import http from 'node:http';
import net from 'node:net';
import { MAX_API_RESPONSE_BYTES } from '@/config/limits';
import { parseApiUrl, type ApiTarget } from '@/server/config/api-url.mjs';

/**
 * Una petición a la API. Todo lo que viaja sale de aquí: nada del navegador (ni `Origin`, ni `Cookie`, ni
 * `Authorization`, ni `Referer`, ni `User-Agent`).
 */
export interface TransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Ruta y consulta, armadas por `operations.ts` con argumentos ya validados. */
  path: string;
  /** Cuerpo JSON ya serializado. */
  body?: string;
  /** Valor de `If-Match`, solo en las entradas. */
  ifMatch?: string;
  /** Plazo total, de abrir el socket al final del cuerpo. */
  timeoutMs: number;
}

/**
 * - `response`: `body` es `null` si la respuesta no trae bytes (el 204 de `DELETE`).
 * - `unreachable`: error de conexión, cierre antes de la respuesta (también un `101`), cierre a medio cuerpo o plazo agotado.
 * - `invalid`: status fuera de 200-599 o respuesta de más de 32 MiB.
 */
export type TransportResult = { kind: 'response'; status: number; body: Uint8Array | null } | { kind: 'unreachable' } | { kind: 'invalid' };

let cached: { raw: string | undefined; target: ApiTarget } | undefined;

/**
 * Destino de la API, de `FRANCA_API_URL`, de forma perezosa y memorizada. Si alguien ejecuta `next` sin el lanzador y la
 * variable no es válida, lanza `ApiUrlError` (el manejador responde 500).
 *
 * @throws {ApiUrlError} Si la variable no es una dirección admitida.
 */
export function getApiTarget(): ApiTarget {
  const raw = process.env.FRANCA_API_URL;
  if (cached === undefined || cached.raw !== raw) cached = { raw, target: parseApiUrl(raw) };
  return cached.target;
}

/** `localhost` sin preguntar al DNS ni a `/etc/hosts`: las dos direcciones de loopback. */
const loopbackLookup: net.LookupFunction = (_hostname, options, callback) => {
  const addresses = [
    { address: '127.0.0.1', family: 4 },
    { address: '::1', family: 6 },
  ];
  if (options.all) callback(null, addresses);
  else callback(null, addresses[0]!.address, 4);
};

function openSocket(target: ApiTarget): net.Socket {
  if (target.family === 'loopback') {
    return net.connect({ port: target.port, host: 'localhost', autoSelectFamily: true, lookup: loopbackLookup });
  }
  return net.connect({ port: target.port, host: target.address });
}

function buildHeaders(request: TransportRequest, target: ApiTarget): Record<string, string> {
  const headers: Record<string, string> = { Host: target.hostHeader, Connection: 'close' };
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(request.body));
  }
  if (request.ifMatch !== undefined) headers['If-Match'] = request.ifMatch;
  return headers;
}

/**
 * Envía **una** petición a la API con `node:http` sobre un socket propio a loopback (D4). Sin `agent`: ni
 * `globalAgent` ni `NODE_USE_ENV_PROXY` ni las variables `HTTP(S)_PROXY` intervienen, y no hay `fetch` (Next lo
 * instrumenta y obedece al proxy del entorno). El transporte no interpreta el cuerpo.
 *
 * @param request La petición.
 * @param target Destino; por defecto el de `FRANCA_API_URL` (los tests inyectan uno).
 * @returns Siempre resuelve.
 * @throws {ApiUrlError} Solo si no se pasa `target` y `FRANCA_API_URL` no es válida.
 */
export function sendToApi(request: TransportRequest, target: ApiTarget = getApiTarget()): Promise<TransportResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TransportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const req = http.request({
      method: request.method,
      path: request.path,
      headers: buildHeaders(request, target),
      createConnection: () => openSocket(target),
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish({ kind: 'unreachable' });
    }, request.timeoutMs);
    req.on('error', () => finish({ kind: 'unreachable' }));
    // Un `close` antes de la respuesta (un `101` incluido) no trae `response` ni `error`.
    req.on('close', () => finish({ kind: 'unreachable' }));
    req.on('response', (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status > 599) {
        response.destroy();
        req.destroy();
        finish({ kind: 'invalid' });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_API_RESPONSE_BYTES) {
          response.destroy();
          req.destroy();
          finish({ kind: 'invalid' });
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish({ kind: 'response', status, body: size === 0 ? null : Buffer.concat(chunks) }));
      response.on('error', () => finish({ kind: 'unreachable' }));
      response.on('close', () => finish({ kind: 'unreachable' }));
    });
    req.end(request.body);
  });
}
