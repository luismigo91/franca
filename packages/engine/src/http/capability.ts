import type { EngineHost, HttpRequest } from '../types.js';

export type Capability = { kind: 'absent' } | { kind: 'present'; call: Function } | { kind: 'error' };

/**
 * Lee `host.http` una sola vez, dentro de un `try`: un getter que lanza es `error`
 * (`http_host_error`) y algo que no es una función es `absent` (`unsupported_node`).
 *
 * @param host Capacidades del host.
 * @returns Qué ofrece el host.
 */
export function readHttpCapability(host: EngineHost): Capability {
  try {
    const call: unknown = host.http;
    return typeof call === 'function' ? { kind: 'present', call } : { kind: 'absent' };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Llama a la capacidad con el host como `this` (un cliente con estado escrito como clase funciona) y
 * espera su resultado. El `catch` no tiene variable a propósito: lo que lanza el host puede llevar
 * la URL, datos personales o el valor de un secreto, y no se mira ni se propaga. El `try` envuelve
 * solo la llamada y su `await`: un defecto del propio motor fuera de esa línea sigue rechazando la promesa.
 *
 * @param call La función leída con `readHttpCapability`.
 * @param host El host (será `this`).
 * @param request La petición de este intento.
 * @returns Lo que resolvió el host, sin leer, o `{ ok: false }` si lanzó o rechazó.
 */
export async function invokeHost(call: Function, host: EngineHost, request: HttpRequest): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await Reflect.apply(call, host, [request]) };
  } catch {
    return { ok: false };
  }
}
