import type { JsonValue, LlmCapability, LlmTurnRequest, LlmTurnResult } from '@franca/engine';
import { createAnthropicClient } from './client.js';
import { messageCostUsd } from './cost.js';
import { classifyError } from './errors.js';
import { buildOutputFormat, readStructuredOutput } from './output.js';
import { resolveOptions, type AnthropicProviderOptions, type ResolvedModel, type ResolvedOptions } from './options.js';
import { buildMessages, buildSystem } from './prompt.js';

/** Cabecera beta del fallback de rechazo en el servidor. */
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const FAILED: LlmTurnResult = { kind: 'failed', costUsd: 0 };
const NOT_CONFIGURED: LlmTurnResult = { kind: 'not_configured' };
const EXPIRED = Symbol('turn-expired');

/** Lee una propiedad de la respuesta sin fiarse de ella: lo que no es un objeto, o cuyo getter lanza, no tiene valor. */
function read(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Convierte una respuesta de la API en el resultado del turno: primero el coste, después `stop_reason`, y solo entonces el contenido. */
function resultOf(message: unknown, request: LlmTurnRequest, options: ResolvedOptions): LlmTurnResult {
  const costUsd = messageCostUsd(message, options);
  const stopReason = read(message, 'stop_reason');
  if (stopReason === 'refusal') return { kind: 'refusal', costUsd };
  if (stopReason !== 'end_turn') return { kind: 'failed', costUsd };
  const output = readStructuredOutput(read(message, 'content'), request.slots);
  if (output === null) return { kind: 'failed', costUsd };
  return { kind: 'turn', text: output.text, slots: output.slots as Record<string, JsonValue>, done: output.done, costUsd };
}

/** El cuerpo de la petición, con el orden de claves que congela el golden. */
function buildBody(request: LlmTurnRequest, model: string, config: ResolvedModel, options: ResolvedOptions) {
  return {
    model,
    max_tokens: options.maxOutputTokens,
    system: buildSystem(request),
    messages: buildMessages(request),
    output_config: { ...(config.effort === null ? {} : { effort: config.effort }), format: buildOutputFormat(request.slots) },
  };
}

/** Avisa de que la temperatura se ignora. Un `onWarning` que lanza no afecta al turno. */
function warnTemperature(request: LlmTurnRequest, model: string, options: ResolvedOptions): void {
  if (request.temperature === null || options.onWarning === null) return;
  try {
    options.onWarning({ code: 'temperature_ignored', nodeId: request.nodeId, model });
  } catch {
    // Un callback defectuoso del host no debe tumbar el turno.
  }
}

/**
 * Crea el proveedor de Claude: una función con la firma de la capacidad `llm` del motor
 * (`createLlmCapability({ principal: createAnthropicProvider() })`). Hace como mucho una petición
 * lógica a la API de Mensajes por turno, con salida estructurada, y **siempre resuelve** con un
 * resultado del contrato: su promesa nunca se rechaza.
 *
 * - Un modelo que no está en la tabla da `not_configured` sin llamar a la API; un 401, 403 o 404, también.
 * - Cualquier otro error (400, 429, 5xx, conexión, tiempo agotado, respuesta sin salida estructurada)
 *   da `failed`. Los reintentos son del SDK (`maxRetries`); el turno entero, reintentos incluidos,
 *   se acota a `turnTimeoutMs`.
 * - El coste lo calcula el proveedor con la tabla de precios: ver `messageCostUsd`.
 * - Ni el contenido de las peticiones o respuestas ni el de los errores salen del proveedor.
 *
 * @param options Cliente, tabla de modelos y límites. Sin `client`, `createAnthropicClient()`.
 * @returns La capacidad `llm`.
 * @throws {TypeError} Con un mensaje fijo si la tabla o alguna opción no se pueden aplicar.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions = {}): LlmCapability {
  const resolved = resolveOptions(options);
  const client = options.client ?? createAnthropicClient();

  const turn = async (request: LlmTurnRequest): Promise<LlmTurnResult> => {
    const model = request.model ?? resolved.defaultModel;
    const config = resolved.models.get(model);
    if (config === undefined) return NOT_CONFIGURED;
    warnTemperature(request, model, resolved);

    const body = buildBody(request, model, config, resolved);
    const useServerFallback = resolved.serverFallback && config.serverFallback;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // El SDK no resuelve nunca si el cliente ignora la señal de aborto: la carrera propia lo cubre.
    const expired = new Promise<typeof EXPIRED>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(EXPIRED);
      }, resolved.turnTimeoutMs);
    });
    const attempt = async (): Promise<{ ok: true; message: unknown } | { ok: false; error: unknown }> => {
      try {
        const requestOptions = { maxRetries: resolved.maxRetries, timeout: resolved.turnTimeoutMs, signal: controller.signal };
        const message: unknown = useServerFallback
          ? await client.beta.messages.create({ ...body, betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' }, requestOptions)
          : await client.messages.create(body, requestOptions);
        return { ok: true, message };
      } catch (error) {
        return { ok: false, error };
      }
    };
    try {
      const settled = await Promise.race([attempt(), expired]);
      if (settled === EXPIRED) return FAILED;
      if (!settled.ok) return classifyError(settled.error) === 'not_configured' ? NOT_CONFIGURED : FAILED;
      return resultOf(settled.message, request, resolved);
    } finally {
      clearTimeout(timer);
    }
  };

  return async (request) => {
    try {
      return await turn(request);
    } catch {
      return FAILED;
    }
  };
}
