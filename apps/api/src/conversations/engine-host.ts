import type { EngineHost, LlmCapability } from '@franca/engine';

/**
 * Host del motor de las conversaciones: solo la capacidad `llm` de un avance y **sin la propiedad `http`**. Así un
 * nodo `http` falla con `unsupported_node` y no hay secretos que resolver ni conexiones salientes. El host `http` de
 * producción es otra feature (ficha `decision-http-deshabilitado-en-conversaciones`).
 *
 * @param llm Capacidad `llm` del avance (`createAdvanceLlm`).
 * @returns El host.
 */
export function buildEngineHost(llm: LlmCapability): EngineHost {
  return { llm };
}
