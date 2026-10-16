import type { HttpAttemptResult } from '../types.js';

/** Los `kind` válidos, atados a `HttpAttemptResult['kind']` (un valor que no esté en el tipo no compila). */
export const HTTP_RESULT_KINDS = [
  'response',
  'timeout',
  'network_error',
  'blocked',
  'response_too_large',
  'missing_secret',
] as const satisfies readonly HttpAttemptResult['kind'][];

/** Resultado ya leído: `network_error` siempre lleva `requestSent` (omitido = `true`). */
export type AttemptResult =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'timeout' }
  | { kind: 'network_error'; requestSent: boolean }
  | { kind: 'blocked' }
  | { kind: 'response_too_large' }
  | { kind: 'missing_secret' };

/**
 * Lee lo que resolvió el host. Cada propiedad se lee una sola vez a una variable local, y solo
 * `kind` y los campos de ese `kind`: `headers`, `set-cookie` o lo que añada el host no se tocan.
 * No se mira la clase ni el prototipo del objeto: la forma la dan sus propiedades.
 *
 * @param raw Lo que resolvió (o devolvió) el host.
 * @returns El resultado, o `null` si está fuera de contrato o si leer una propiedad lanza.
 */
export function readAttemptResult(raw: unknown): AttemptResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  try {
    const kind = source.kind;
    switch (kind) {
      case 'response': {
        const status = source.status;
        const body = source.body;
        if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) return null;
        if (typeof body !== 'string') return null;
        return { kind, status, body };
      }
      case 'network_error': {
        const requestSent = source.requestSent;
        if (requestSent !== undefined && typeof requestSent !== 'boolean') return null;
        return { kind, requestSent: requestSent ?? true };
      }
      case 'timeout':
      case 'blocked':
      case 'response_too_large':
      case 'missing_secret':
        return { kind };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
