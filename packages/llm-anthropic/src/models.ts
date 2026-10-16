/** Profundidad de razonamiento que la API admite en `output_config.effort`. */
export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Los valores válidos de `effort`, para validar la tabla de la instalación. */
export const ANTHROPIC_EFFORTS: readonly AnthropicEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Dólares por millón de tokens. */
export interface AnthropicPrices {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
  cacheWriteUsdPerMTok: number;
}

/** Cómo se usa y se cobra un modelo. */
export interface AnthropicModelConfig {
  /** Tarifa base. */
  prices: AnthropicPrices;
  /** Si el prompt (entrada + lectura + escritura de caché) supera el umbral, todo el turno va a esta tarifa. */
  longPrompt?: { thresholdTokens: number; prices: AnthropicPrices };
  /** Sin él, no se envía `effort` (la API usa el suyo). */
  effort?: AnthropicEffort;
  /** Si el modelo admite el fallback de rechazo en el servidor. Por defecto `false`. */
  serverFallback?: boolean;
}

const prices = (input: number, output: number, cacheRead: number, cacheWrite: number): AnthropicPrices => ({
  inputUsdPerMTok: input,
  outputUsdPerMTok: output,
  cacheReadUsdPerMTok: cacheRead,
  cacheWriteUsdPerMTok: cacheWrite,
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Modelo que se usa cuando ni la petición ni `options.defaultModel` lo indican. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/**
 * Tabla por defecto, en dólares por millón de tokens (entrada / salida / lectura de caché / escritura
 * de caché con TTL de 5 minutos). La escritura de caché cuesta 1,25 × la entrada; la lectura, 0,05 × en
 * Opus, 0,1 × en Sonnet y en Haiku. `effort` `low` en los tres: un paso conversacional no necesita
 * razonamiento profundo. Haiku no tiene fallback de rechazo en el servidor.
 *
 * Precios de la referencia oficial a fecha de 2026-10-16; revisarlos antes de cada release.
 */
export const DEFAULT_ANTHROPIC_MODELS: Readonly<Record<string, AnthropicModelConfig>> = deepFreeze({
  'claude-opus-5-5': { prices: prices(4, 20, 0.2, 5), effort: 'low', serverFallback: true },
  'claude-sonnet-5-5': { prices: prices(2, 10, 0.2, 2.5), effort: 'low', serverFallback: true },
  'claude-haiku-5-5': {
    prices: prices(0.1, 0.5, 0.01, 0.125),
    longPrompt: { thresholdTokens: 100000, prices: prices(0.5, 2.5, 0.05, 0.625) },
    effort: 'low',
  },
});
