import type { HttpMethod } from '@franca/engine';

/** Una cabecera del cable: nombre con su capitalización y valor. */
export type WireHeader = readonly [name: string, value: string];

export interface RequestHeadersInput {
  readonly method: HttpMethod;
  readonly url: URL;
  /** Las cabeceras del nodo, en su orden, con los secretos ya resueltos. */
  readonly headers: readonly WireHeader[];
  /** JSON compacto, o `null` sin body. */
  readonly body: string | null;
}

const METHODS_WITH_EMPTY_LENGTH: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

const defines = (headers: readonly WireHeader[], name: string): boolean => headers.some(([candidate]) => candidate.toLowerCase() === name);

/**
 * Las cabeceras de la petición, en este orden: `Host` (el host de la `url`, con puerto solo si no es el de por defecto), las
 * del nodo, `Accept-Encoding: gzip, deflate, br` y `User-Agent: Franca` si el nodo no las define (sin distinguir
 * mayúsculas), `Content-Length` con los bytes UTF-8 del body (o `0` en `POST`, `PUT` y `PATCH` sin body, como
 * recomienda RFC 9110) y `Connection: close`. Nunca cookies, credenciales ni cabeceras del entorno.
 *
 * @param input Método, URL, cabeceras del nodo y body.
 * @returns Las cabeceras del cable.
 */
export function buildRequestHeaders(input: RequestHeadersInput): WireHeader[] {
  const wire: WireHeader[] = [['Host', input.url.host], ...input.headers];
  if (!defines(input.headers, 'accept-encoding')) wire.push(['Accept-Encoding', 'gzip, deflate, br']);
  if (!defines(input.headers, 'user-agent')) wire.push(['User-Agent', 'Franca']);
  if (input.body !== null) wire.push(['Content-Length', String(Buffer.byteLength(input.body, 'utf8'))]);
  else if (METHODS_WITH_EMPTY_LENGTH.has(input.method)) wire.push(['Content-Length', '0']);
  wire.push(['Connection', 'close']);
  return wire;
}

/** La ruta de la petición: `pathname` y consulta. */
export function requestPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}
