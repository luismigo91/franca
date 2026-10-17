import type { EngineHost, HttpCapability, LlmCapability } from '@franca/engine';

/**
 * Host del motor de las conversaciones: la capacidad `llm` y la `http` de un avance. Un nodo `http` llama a la salida http
 * de la API (`http-host`); sin ella el motor lo trataría como `unsupported_node`.
 *
 * @param llm Capacidad `llm` del avance (`createAdvanceLlm`).
 * @param http Capacidad `http` del avance (`HttpHost.forAdvance`), con el mismo inicio de plazo que `llm`.
 * @returns El host.
 */
export function buildEngineHost(llm: LlmCapability, http: HttpCapability): EngineHost {
  return { llm, http };
}
