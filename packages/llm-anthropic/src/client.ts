import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';

type OpenTelemetryOption = NonNullable<ClientOptions['openTelemetry']>;

/** Las trazas solo de metadatos, o desactivadas si las opciones lo piden. */
function metadataOnlyTelemetry(option: ClientOptions['openTelemetry']): OpenTelemetryOption {
  if (option === false) return false;
  const traces = option?.traces;
  if (traces === false || (typeof traces === 'object' && traces.enabled === false)) return option as OpenTelemetryOption;
  return { ...option, traces: { ...(typeof traces === 'object' ? traces : {}), contentMode: 'metadata_only' } };
}

/**
 * Crea un cliente del SDK que no registra contenido: `logLevel` `"off"` (las opciones ganan a
 * `ANTHROPIC_LOG`, que con `debug` vuelca los detalles de cada petición) y trazas de OpenTelemetry
 * solo de metadatos (un cliente con la opción no lee `ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE`),
 * o desactivadas si las opciones lo piden. Así ni una variable de entorno de la máquina ni un `debug`
 * olvidado vuelcan conversaciones.
 *
 * Las credenciales las resuelve el SDK desde el entorno, salvo que se pasen en `options` (la feature
 * que despliega el host crea un cliente por tenant con `apiKey` y `baseURL` explícitos).
 *
 * @param options Opciones del SDK.
 * @returns El cliente.
 */
export function createAnthropicClient(options: ClientOptions = {}): Anthropic {
  return new Anthropic({ ...options, logLevel: 'off', openTelemetry: metadataOnlyTelemetry(options.openTelemetry) });
}
