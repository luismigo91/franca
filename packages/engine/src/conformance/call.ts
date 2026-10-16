import { readAttemptResult, type AttemptResult } from '../http/result.js';
import type { HttpCapability, HttpRequest } from '../types.js';
import type { HostConformanceHarness } from './types.js';

/** Margen que se suma a `timeoutMs` y a la tolerancia en la espera límite de cada llamada. */
export const CALL_DEADLINE_MARGIN_MS = 1000;

export interface CallOutcome {
  /** El resultado leído con el mismo lector del motor, o `null` si no hay uno válido. */
  result: AttemptResult | null;
  /** Milisegundos medidos con `harness.now()`. */
  elapsedMs: number;
  /** Fallos de contrato de esta llamada (vacío si el host resolvió con un resultado válido). */
  failures: string[];
}

/**
 * Hace una llamada al host bajo prueba sin rechazar nunca. Anota un fallo si la promesa se rechaza, si
 * el resultado no pasa `readAttemptResult` (el mismo lector del motor: no puede haber deriva entre
 * lo que la suite exige y lo que el motor acepta) o si el host no resuelve en
 * `timeoutMs + timeToleranceMs + CALL_DEADLINE_MARGIN_MS`, en cuyo caso falla el caso con un mensaje
 * claro en vez de morir por el timeout genérico del runner. El `catch` no tiene variable: lo que
 * lance el host puede llevar datos personales o secretos.
 *
 * @param harness El arnés (aporta el reloj y la espera).
 * @param request La petición a ejecutar.
 * @param label Texto que identifica la llamada en los fallos (sin valores sensibles).
 * @param capability La capacidad a llamar; por defecto `harness.http()`.
 */
export async function call(
  harness: HostConformanceHarness,
  request: HttpRequest,
  label: string,
  capability: HttpCapability = harness.http(),
): Promise<CallOutcome> {
  const limit = request.timeoutMs + harness.timeToleranceMs + CALL_DEADLINE_MARGIN_MS;
  const started = harness.now();
  type Settled = { kind: 'resolved'; raw: unknown } | { kind: 'rejected' } | { kind: 'deadline' };
  const attempt = (async (): Promise<Settled> => {
    try {
      return { kind: 'resolved', raw: await capability(request) };
    } catch {
      return { kind: 'rejected' };
    }
  })();
  const deadline = harness.sleep(limit).then((): Settled => ({ kind: 'deadline' }));
  const settled = await Promise.race([attempt, deadline]);
  const elapsedMs = harness.now() - started;
  if (settled.kind === 'rejected') {
    return { result: null, elapsedMs, failures: [`${label}: la promesa del host se rechazó (debe resolver siempre)`] };
  }
  if (settled.kind === 'deadline') {
    return { result: null, elapsedMs, failures: [`${label}: el host no resolvió en ${limit} ms`] };
  }
  const result = readAttemptResult(settled.raw);
  if (result === null) return { result: null, elapsedMs, failures: [`${label}: el host devolvió algo fuera de contrato`] };
  return { result, elapsedMs, failures: [] };
}
