import type Anthropic from '@anthropic-ai/sdk';
import {
  ANTHROPIC_EFFORTS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_MODELS,
  type AnthropicEffort,
  type AnthropicModelConfig,
  type AnthropicPrices,
} from './models.js';

/** Aviso que el proveedor comunica por `onWarning`: solo un código fijo, el nodo y el modelo. Nunca contenido. */
export interface AnthropicWarning {
  code: 'temperature_ignored';
  nodeId: string;
  model: string;
}

export interface AnthropicProviderOptions {
  /** Cliente del SDK. Sin él, `createAnthropicClient()` (credenciales del entorno, resueltas por el SDK). */
  client?: Pick<Anthropic, 'messages' | 'beta'>;
  /** Modelo de los nodos sin `model`. Por defecto `claude-opus-5-5`. */
  defaultModel?: string;
  /** Sustituye a la tabla por defecto; para ampliarla, `{ ...DEFAULT_ANTHROPIC_MODELS, … }`. */
  models?: Readonly<Record<string, AnthropicModelConfig>>;
  /** `max_tokens` de cada petición. Por defecto 8192. */
  maxOutputTokens?: number;
  /** Reintentos del SDK ante errores transitorios. Por defecto 2. */
  maxRetries?: number;
  /** Tiempo total de un turno, reintentos incluidos. Por defecto 60000. */
  turnTimeoutMs?: number;
  /** `false` desactiva el fallback de rechazo en el servidor en todos los modelos. Por defecto `true`. */
  serverFallback?: boolean;
  /** Recibe avisos sin contenido. Si lanza, el turno sigue. */
  onWarning?: (warning: AnthropicWarning) => void;
}

/** Un modelo de la tabla ya validado y copiado. */
export interface ResolvedModel {
  prices: AnthropicPrices;
  longPrompt: { thresholdTokens: number; prices: AnthropicPrices } | null;
  effort: AnthropicEffort | null;
  serverFallback: boolean;
}

/** Las opciones ya validadas, listas para usar (sin cliente: lo crea el proveedor). */
export interface ResolvedOptions {
  defaultModel: string;
  /** Copia de la tabla en un `Map`: un `model` del flujo como `constructor` o `__proto__` no encuentra nada. */
  models: ReadonlyMap<string, ResolvedModel>;
  /** El precio más alto de cada concepto de toda la tabla (tarifas base y de prompt largo): el de un modelo desconocido. */
  maxPrices: AnthropicPrices;
  maxOutputTokens: number;
  maxRetries: number;
  turnTimeoutMs: number;
  serverFallback: boolean;
  onWarning: ((warning: AnthropicWarning) => void) | null;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TURN_TIMEOUT_MS = 60000;
/** Mayor retardo que admite un temporizador de JavaScript. */
const MAX_TIMER_MS = 2147483647;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function readPrices(value: unknown): AnthropicPrices | null {
  if (!isRecord(value)) return null;
  const { inputUsdPerMTok, outputUsdPerMTok, cacheReadUsdPerMTok, cacheWriteUsdPerMTok } = value;
  if (![inputUsdPerMTok, outputUsdPerMTok, cacheReadUsdPerMTok, cacheWriteUsdPerMTok].every(isPrice)) return null;
  return { inputUsdPerMTok: inputUsdPerMTok as number, outputUsdPerMTok: outputUsdPerMTok as number, cacheReadUsdPerMTok: cacheReadUsdPerMTok as number, cacheWriteUsdPerMTok: cacheWriteUsdPerMTok as number };
}

function readModel(value: unknown): ResolvedModel {
  if (!isRecord(value)) throw new TypeError('models: cada modelo debe ser un objeto');
  const prices = readPrices(value.prices);
  if (prices === null) throw new TypeError('models: cada modelo necesita una tarifa base con precios finitos mayores o iguales que 0');
  let longPrompt: ResolvedModel['longPrompt'] = null;
  if (value.longPrompt !== undefined) {
    if (!isRecord(value.longPrompt)) throw new TypeError('models: longPrompt debe ser un objeto');
    const { thresholdTokens } = value.longPrompt;
    const longPrices = readPrices(value.longPrompt.prices);
    if (typeof thresholdTokens !== 'number' || !Number.isInteger(thresholdTokens) || thresholdTokens < 1) {
      throw new TypeError('models: el umbral de prompt largo debe ser un entero mayor o igual que 1');
    }
    if (longPrices === null) throw new TypeError('models: la tarifa de prompt largo necesita precios finitos mayores o iguales que 0');
    longPrompt = { thresholdTokens, prices: longPrices };
  }
  const effort = value.effort;
  if (effort !== undefined && !ANTHROPIC_EFFORTS.includes(effort as AnthropicEffort)) throw new TypeError('models: effort no es válido');
  const serverFallback = value.serverFallback;
  if (serverFallback !== undefined && typeof serverFallback !== 'boolean') throw new TypeError('models: serverFallback debe ser un boolean');
  return { prices, longPrompt, effort: (effort as AnthropicEffort | undefined) ?? null, serverFallback: serverFallback === true };
}

/** El mayor de cada concepto entre todas las tarifas de la tabla. */
function highestPrices(models: ReadonlyMap<string, ResolvedModel>): AnthropicPrices {
  const all = [...models.values()].flatMap((model) => (model.longPrompt ? [model.prices, model.longPrompt.prices] : [model.prices]));
  const highest = (pick: (prices: AnthropicPrices) => number): number => Math.max(...all.map(pick));
  return {
    inputUsdPerMTok: highest((p) => p.inputUsdPerMTok),
    outputUsdPerMTok: highest((p) => p.outputUsdPerMTok),
    cacheReadUsdPerMTok: highest((p) => p.cacheReadUsdPerMTok),
    cacheWriteUsdPerMTok: highest((p) => p.cacheWriteUsdPerMTok),
  };
}

function readInteger(value: unknown, fallback: number, min: number, max: number, message: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new TypeError(message);
  return value;
}

/**
 * Valida las opciones y copia la tabla de modelos.
 *
 * @param options Opciones de la instalación.
 * @returns Las opciones listas para usar.
 * @throws {TypeError} Con un mensaje fijo, sin valores, si la tabla o alguna opción no se pueden aplicar.
 */
export function resolveOptions(options: AnthropicProviderOptions): ResolvedOptions {
  const table = options.models ?? DEFAULT_ANTHROPIC_MODELS;
  if (!isRecord(table)) throw new TypeError('models: la tabla debe ser un objeto');
  const models = new Map<string, ResolvedModel>();
  for (const name of Object.keys(table)) models.set(name, readModel(table[name]));
  if (models.size === 0) throw new TypeError('models: la tabla debe tener al menos un modelo');

  const defaultModel = options.defaultModel ?? DEFAULT_ANTHROPIC_MODEL;
  if (typeof defaultModel !== 'string') throw new TypeError('defaultModel debe ser un string');
  if (options.serverFallback !== undefined && typeof options.serverFallback !== 'boolean') throw new TypeError('serverFallback debe ser un boolean');
  if (options.onWarning !== undefined && typeof options.onWarning !== 'function') throw new TypeError('onWarning debe ser una función');

  return {
    defaultModel,
    models,
    maxPrices: highestPrices(models),
    maxOutputTokens: readInteger(options.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, 1, Number.MAX_SAFE_INTEGER, 'maxOutputTokens debe ser un entero mayor o igual que 1'),
    maxRetries: readInteger(options.maxRetries, DEFAULT_MAX_RETRIES, 0, Number.MAX_SAFE_INTEGER, 'maxRetries debe ser un entero mayor o igual que 0'),
    turnTimeoutMs: readInteger(options.turnTimeoutMs, DEFAULT_TURN_TIMEOUT_MS, 1, MAX_TIMER_MS, 'turnTimeoutMs debe ser un entero entre 1 y 2147483647'),
    serverFallback: options.serverFallback !== false,
    onWarning: options.onWarning ?? null,
  };
}
