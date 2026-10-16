import { readTurnResult, type TurnResult } from '../llm/result.js';
import type { LlmCapability, LlmTurnRequest } from '../types.js';
import type { HostConformanceHarness } from './types.js';

/** Espera máxima de un turno en la suite: una petición `llm` no lleva `timeoutMs`. */
export const LLM_CALL_DEADLINE_MS = 30000;

export interface LlmCallOutcome {
  /** El resultado leído con el mismo lector del motor, o `null` si no hay uno válido. */
  result: TurnResult | null;
  /** Fallos de contrato de esta llamada (vacío si el host resolvió con un resultado válido). */
  failures: string[];
}

/**
 * Hace un turno contra la capacidad `llm` del host bajo prueba sin rechazar nunca. Anota un fallo si
 * la promesa se rechaza, si el resultado no pasa `readTurnResult` (el mismo lector del motor: no puede
 * haber deriva entre lo que la suite exige y lo que el motor acepta) o si el host no resuelve en
 * `LLM_CALL_DEADLINE_MS`, en cuyo caso falla el caso con un mensaje claro en vez de morir por el
 * timeout genérico del runner. El `catch` no tiene variable: lo que lance el host puede llevar la
 * conversación.
 *
 * @param harness El arnés (aporta la espera).
 * @param request La petición del turno.
 * @param label Texto que identifica la llamada en los fallos (sin datos).
 * @param capability La capacidad a llamar (normalmente `harness.llm(provider)`).
 */
export async function callLlm(
  harness: HostConformanceHarness,
  request: LlmTurnRequest,
  label: string,
  capability: LlmCapability,
): Promise<LlmCallOutcome> {
  type Settled = { kind: 'resolved'; raw: unknown } | { kind: 'rejected' } | { kind: 'deadline' };
  const attempt = (async (): Promise<Settled> => {
    try {
      return { kind: 'resolved', raw: await capability(request) };
    } catch {
      return { kind: 'rejected' };
    }
  })();
  // La espera límite se cancela en cuanto el host responde: no queda un temporizador por llamada.
  const stopWaiting = new AbortController();
  const deadline = harness.sleep(LLM_CALL_DEADLINE_MS, stopWaiting.signal).then(
    (): Settled => ({ kind: 'deadline' }),
    (): Settled => ({ kind: 'deadline' }),
  );
  const settled = await Promise.race([attempt, deadline]);
  stopWaiting.abort();
  if (settled.kind === 'rejected') return { result: null, failures: [`${label}: la promesa del host se rechazó (debe resolver siempre)`] };
  if (settled.kind === 'deadline') return { result: null, failures: [`${label}: el host no resolvió en ${LLM_CALL_DEADLINE_MS} ms`] };
  const specs = request.slots.map((slot) => ({ name: slot.name, type: slot.type, description: slot.description, required: slot.required }));
  const result = readTurnResult(settled.raw, specs);
  if (result === null) return { result: null, failures: [`${label}: el host devolvió algo fuera de contrato`] };
  return { result, failures: [] };
}
