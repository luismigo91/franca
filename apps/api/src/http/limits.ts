/** Bytes máximos del cuerpo de una petición (1 MiB), contados tal como llegan. */
export const MAX_BODY_BYTES = 1_048_576;

/**
 * Milisegundos máximos para recibir una petición entera (`server.requestTimeout`; el de Node son 300 s). Una petición
 * que declara más cuerpo del que envía recibe 408 y se cierra, en vez de retener la conexión cinco minutos.
 */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Milisegundos máximos para recibir las cabeceras (`server.headersTimeout`); no puede superar `REQUEST_TIMEOUT_MS`. */
export const HEADERS_TIMEOUT_MS = 10_000;
/** Cada cuánto comprueba Node los plazos anteriores (por defecto 30 s: un plazo de 30 s valdría hasta 60 s). */
export const CONNECTIONS_CHECKING_INTERVAL_MS = 5000;
