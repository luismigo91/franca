import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';

/**
 * Crea un cliente del SDK que no registra contenido: `logLevel` `"off"` (las opciones ganan a
 * `ANTHROPIC_LOG`, que con `debug` vuelca los detalles de cada petición) y trazas de OpenTelemetry sin
 * contenido: si el entorno o las opciones piden `content`, se baja a `metadata_only`. El resto de lo que
 * el SDK resolvió del entorno se respeta (por ejemplo `ANTHROPIC_OPEN_TELEMETRY=false` desactiva las trazas).
 *
 * Las credenciales las resuelve el SDK desde el entorno, salvo que se pasen en `options` (la feature
 * que despliega el host crea un cliente por tenant con la clave y la URL base explícitas).
 *
 * @param options Opciones del SDK.
 * @returns El cliente.
 */
export function createAnthropicClient(options: ClientOptions = {}): Anthropic {
  const client = new Anthropic({ ...options, logLevel: 'off' });
  const { openTelemetry } = client;
  if (openTelemetry.traces.contentMode !== 'content') return client;
  return client.withOptions({ openTelemetry: { ...openTelemetry, traces: { ...openTelemetry.traces, contentMode: 'metadata_only' } } });
}
