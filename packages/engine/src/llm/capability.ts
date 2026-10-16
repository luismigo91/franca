import type { EngineHost, LlmTurnRequest } from '../types.js';

export type LlmCapabilityRead = { kind: 'absent' } | { kind: 'present'; call: Function } | { kind: 'error' };

/**
 * Lee `host.llm` una sola vez, dentro de un `try`: un getter que lanza es `error`
 * (`llm_host_error`) y algo que no es una función es `absent` (`unsupported_node`).
 *
 * @param host Capacidades del host.
 * @returns Qué ofrece el host.
 */
export function readLlmCapability(host: EngineHost): LlmCapabilityRead {
  try {
    const call: unknown = host.llm;
    return typeof call === 'function' ? { kind: 'present', call } : { kind: 'absent' };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Llama a la capacidad con el host como `this` (un host escrito como clase funciona) y espera su
 * resultado. El `catch` no tiene variable a propósito: lo que lanza el host puede contener la
 * conversación y no se mira ni se propaga. El `try` envuelve solo la llamada y su `await`.
 *
 * @param call La función leída con `readLlmCapability`.
 * @param host El host (será `this`).
 * @param request La petición de este turno.
 * @returns Lo que resolvió el host, sin leer, o `{ ok: false }` si lanzó o rechazó.
 */
export async function invokeLlm(call: Function, host: EngineHost, request: LlmTurnRequest): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await Reflect.apply(call, host, [request]) };
  } catch {
    return { ok: false };
  }
}
