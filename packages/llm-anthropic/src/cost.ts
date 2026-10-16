import type { AnthropicPrices } from './models.js';
import type { ResolvedModel, ResolvedOptions } from './options.js';

/** Un contador de tokens: un entero seguro ≥ 0. Ausente, `null`, negativo, fraccionario, NaN, 1e400 o un string cuentan 0. */
const counter = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** Lee una propiedad sin fiarse del objeto: lo que no es un objeto, o cuyo getter lanza, no tiene valor. */
function read(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Las tarifas que se aplican a un `usage`: las del modelo (base o prompt largo) o, si no está en la tabla, el máximo de cada concepto. */
function pricesFor(model: ResolvedModel | undefined, promptTokens: number, maxPrices: AnthropicPrices): AnthropicPrices {
  if (model === undefined) return maxPrices;
  return model.longPrompt !== null && promptTokens > model.longPrompt.thresholdTokens ? model.longPrompt.prices : model.prices;
}

/** Coste de un bloque de `usage` (o de una iteración) con el modelo dado. */
function usageCost(usage: unknown, model: unknown, options: Pick<ResolvedOptions, 'models' | 'maxPrices'>): number {
  const input = counter(read(usage, 'input_tokens'));
  const output = counter(read(usage, 'output_tokens'));
  const cacheRead = counter(read(usage, 'cache_read_input_tokens'));
  const cacheWrite = counter(read(usage, 'cache_creation_input_tokens'));
  const prices = pricesFor(typeof model === 'string' ? options.models.get(model) : undefined, input + cacheRead + cacheWrite, options.maxPrices);
  return (input * prices.inputUsdPerMTok + output * prices.outputUsdPerMTok + cacheRead * prices.cacheReadUsdPerMTok + cacheWrite * prices.cacheWriteUsdPerMTok) / 1e6;
}

/**
 * Coste en dólares de una respuesta de la API. Es el mayor de dos importes: el `usage` de la
 * cabecera con el modelo que indica la respuesta y, si trae `usage.iterations` con al menos una
 * entrada (una por salto del fallback del servidor), la suma del coste de cada entrada con su
 * propio modelo. Con fallback la cabecera puede sumar los tokens de todos los saltos y cobrarse con el
 * modelo que sirvió (más barato), y una iteración puede no traer `model`; sumar las dos cuentas
 * contaría dos veces. El máximo nunca queda por debajo de ninguna lectura razonable, así que
 * `costCapUsd` queda del lado seguro. Un modelo desconocido paga el precio más alto de cada concepto.
 *
 * El resultado es siempre un number finito ≥ 0: los contadores son enteros seguros, y si un precio
 * enorme de la instalación desbordara la cuenta, se devuelve `Number.MAX_VALUE`.
 *
 * @param message Respuesta de la API (sin tipar: se lee de forma defensiva).
 * @param options Tabla de modelos y precios máximos ya validados.
 */
export function messageCostUsd(message: unknown, options: Pick<ResolvedOptions, 'models' | 'maxPrices'>): number {
  const usage = read(message, 'usage');
  const topLevel = usageCost(usage, read(message, 'model'), options);
  const iterations = read(usage, 'iterations');
  let summed = 0;
  if (Array.isArray(iterations) && iterations.length > 0) {
    for (const iteration of iterations) summed += usageCost(iteration, read(iteration, 'model'), options);
  }
  const cost = Math.max(topLevel, summed);
  return Number.isFinite(cost) ? cost : Number.MAX_VALUE;
}
