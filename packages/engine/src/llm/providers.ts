import type { LlmCapability, LlmTurnRequest, LlmTurnResult } from '../types.js';

// Congelado: el mismo objeto se devuelve en cada petición y un proveedor no debe poder mutarlo para las siguientes.
const NOT_CONFIGURED: LlmTurnResult = Object.freeze({ kind: 'not_configured' });

/** Entradas propias y enumerables de un objeto, o las de un `Map`. Un `__proto__` de `JSON.parse` es propio y cuenta. */
function entriesOf(providers: unknown): [string, unknown][] {
  if (providers instanceof Map) return [...providers.entries()] as [string, unknown][];
  if (typeof providers !== 'object' || providers === null) throw new TypeError('los proveedores deben ser un objeto o un Map');
  return Object.keys(providers).map((name) => [name, (providers as Record<string, unknown>)[name]]);
}

/**
 * Compone la capacidad `llm` de un host a partir de los proveedores que configura la instalación.
 * Cada petición va al proveedor cuyo nombre coincide exactamente con `request.provider`; si ninguno
 * coincide, resuelve `not_configured` sin llamar a nadie.
 *
 * Los proveedores se copian a un `Map` al crearse: cambiar después el objeto no cambia el enrutado
 * (determinismo) y `Map.get` no encuentra `constructor` ni `toString` como si fueran proveedores.
 *
 * @param providers Nombre de proveedor → función con la firma de la capacidad `llm`.
 * @returns La capacidad `llm`, lista para `EngineHost.llm`.
 * @throws {TypeError} Si `providers` no es un objeto o un `Map`, o si algún valor no es una función.
 */
export function createLlmCapability(providers: Readonly<Record<string, LlmCapability>> | ReadonlyMap<string, LlmCapability>): LlmCapability {
  const routes = new Map<string, LlmCapability>();
  for (const [name, provider] of entriesOf(providers)) {
    if (typeof provider !== 'function') throw new TypeError('cada proveedor debe ser una función');
    routes.set(name, provider as LlmCapability);
  }
  return async (request: LlmTurnRequest): Promise<LlmTurnResult> => {
    const provider = routes.get(request.provider);
    if (provider === undefined) return NOT_CONFIGURED;
    // Sin `this`: el proveedor no es un método del host.
    return Reflect.apply(provider, undefined, [request]) as Promise<LlmTurnResult>;
  };
}
