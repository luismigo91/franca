import { MAX_RESPONSE_BODY_LENGTH, type HttpErrorReason } from '../constants.js';
import type { HttpMethod } from '../types.js';
import type { AttemptResult } from './result.js';

/** Métodos idempotentes de RFC 9110. El tipo mapeado hace fallar `tsc` si el esquema añade un método. */
export const IDEMPOTENT: { readonly [M in HttpMethod]: boolean } = {
  GET: true,
  PUT: true,
  DELETE: true,
  POST: false,
  PATCH: false,
};

export type Verdict =
  | { ok: true; status: number; body: string }
  | { ok: false; reason: HttpErrorReason; status: number | null; retryable: boolean };

const RETRY_ANY_METHOD = new Set([408, 429]);
const RETRY_IF_IDEMPOTENT = new Set([500, 502, 503, 504]);

/**
 * Juzga un intento. El tamaño del cuerpo se comprueba antes que el status y antes de cualquier
 * `JSON.parse`. Qué se reintenta es una tabla: 408, 429 y `network_error` con `requestSent: false`
 * en cualquier método; 500/502/503/504, `timeout` y `network_error` con la petición enviada solo
 * en métodos idempotentes (en `POST`/`PATCH` el servidor pudo haberla procesado).
 *
 * @param result Resultado del intento, distinto de `missing_secret`.
 * @param method Método del nodo.
 * @returns Éxito, o el motivo, el status del intento y si es reintentable.
 */
export function judgeAttempt(result: Exclude<AttemptResult, { kind: 'missing_secret' }>, method: HttpMethod): Verdict {
  const idempotent = IDEMPOTENT[method];
  switch (result.kind) {
    case 'response': {
      const { status, body } = result;
      if (body.length > MAX_RESPONSE_BODY_LENGTH) return { ok: false, reason: 'response_too_large', status, retryable: false };
      if (status >= 200 && status <= 299) return { ok: true, status, body };
      const retryable = RETRY_ANY_METHOD.has(status) || (idempotent && RETRY_IF_IDEMPOTENT.has(status));
      return { ok: false, reason: 'http_status', status, retryable };
    }
    case 'timeout':
      return { ok: false, reason: 'timeout', status: null, retryable: idempotent };
    case 'network_error':
      return { ok: false, reason: 'network_error', status: null, retryable: !result.requestSent || idempotent };
    case 'blocked':
      return { ok: false, reason: 'blocked', status: null, retryable: false };
    case 'response_too_large':
      return { ok: false, reason: 'response_too_large', status: null, retryable: false };
  }
}
