import { describe, expect, it } from 'vitest';
import { messageCostUsd } from '../../src/cost.js';
import { resolveOptions } from '../../src/options.js';
import type { AnthropicModelConfig } from '../../src/models.js';
import { pick, prng } from '../helpers/prng.js';

const options = resolveOptions({});
const cost = (message: unknown, opts = options) => messageCostUsd(message, opts);
const usage = (u: Record<string, unknown>, model = 'claude-opus-5-5', extra: Record<string, unknown> = {}) => ({ model, usage: u, ...extra });

describe('messageCostUsd: la fórmula de la spec', () => {
  it('entrada, salida, lectura y escritura de caché a sus precios por millón', () => {
    expect(cost(usage({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400 }))).toBeCloseTo(0.0164, 12);
  });

  it.each([
    ['claude-opus-5-5', { input_tokens: 1_000_000 }, 4],
    ['claude-opus-5-5', { output_tokens: 1_000_000 }, 20],
    ['claude-opus-5-5', { cache_read_input_tokens: 1_000_000 }, 0.2],
    ['claude-opus-5-5', { cache_creation_input_tokens: 1_000_000 }, 5],
    ['claude-sonnet-5-5', { input_tokens: 1_000_000 }, 2],
    ['claude-sonnet-5-5', { output_tokens: 1_000_000 }, 10],
    ['claude-sonnet-5-5', { cache_read_input_tokens: 1_000_000 }, 0.2],
    ['claude-sonnet-5-5', { cache_creation_input_tokens: 1_000_000 }, 2.5],
    ['claude-haiku-5-5', { input_tokens: 1_000_000 }, 0.5],
    ['claude-haiku-5-5', { input_tokens: 90_000, output_tokens: 1_000_000 }, 0.009 + 0.5],
  ])('%s con %j cuesta %d dólares por millón', (model, tokens, dollars) => {
    expect(cost(usage(tokens, model))).toBeCloseTo(dollars, 9);
  });

  it('sin usage, o con un usage que no es un objeto, cuesta 0', () => {
    for (const message of [undefined, null, {}, { usage: null }, { usage: 5 }, { usage: 'x' }, 5, 'x']) expect(cost(message)).toBe(0);
  });

  it('un getter que lanza en el mensaje, el usage o una iteración no rompe el cálculo', () => {
    const boom = { get usage(): never { throw new Error('MARCA-ERROR'); } };
    expect(cost(boom)).toBe(0);
    const iteration = { get input_tokens(): never { throw new Error('MARCA-ERROR'); }, output_tokens: 1000 };
    expect(cost({ model: 'claude-opus-5-5', usage: { input_tokens: 0, iterations: [iteration] } })).toBeCloseTo(0.02, 12);
  });
});

describe('messageCostUsd: contadores y modelos', () => {
  it.each([null, undefined, -1, 1.5, Number.NaN, Infinity, '1000', 1e400, {}, [], true])('un input_tokens %j cuenta 0', (input_tokens) => {
    expect(cost(usage({ input_tokens, output_tokens: 0 }))).toBe(0);
  });

  it('un modelo desconocido, ausente o que no es un string paga el precio más alto de cada concepto', () => {
    for (const model of ['claude-otro', undefined, null, 5, 'constructor', '__proto__', '']) {
      expect(cost({ model, usage: { input_tokens: 1000, output_tokens: 500 } }), String(model)).toBeCloseTo(0.014, 12);
    }
  });

  it('los precios máximos salen de todas las tarifas, también de la de prompt largo', () => {
    const cheapBase: AnthropicModelConfig = { prices: { inputUsdPerMTok: 1, outputUsdPerMTok: 1, cacheReadUsdPerMTok: 1, cacheWriteUsdPerMTok: 1 } };
    const longHigh: AnthropicModelConfig = {
      prices: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.1, cacheReadUsdPerMTok: 0.1, cacheWriteUsdPerMTok: 0.1 },
      longPrompt: { thresholdTokens: 10, prices: { inputUsdPerMTok: 50, outputUsdPerMTok: 60, cacheReadUsdPerMTok: 70, cacheWriteUsdPerMTok: 80 } },
    };
    const table = resolveOptions({ models: { cheapBase, longHigh } });
    expect(table.maxPrices).toEqual({ inputUsdPerMTok: 50, outputUsdPerMTok: 60, cacheReadUsdPerMTok: 70, cacheWriteUsdPerMTok: 80 });
    expect(cost({ model: 'desconocido', usage: { input_tokens: 1_000_000 } }, table)).toBeCloseTo(50, 9);
  });

  it('el umbral es estricto (> y no ≥) y cuenta la entrada, la lectura y la escritura de caché', () => {
    const haiku = (u: Record<string, number>) => cost(usage(u, 'claude-haiku-5-5'));
    expect(haiku({ input_tokens: 100000 })).toBeCloseTo(100000 * 0.1 / 1e6, 12);
    expect(haiku({ input_tokens: 100001 })).toBeCloseTo(100001 * 0.5 / 1e6, 12);
    expect(haiku({ input_tokens: 1, cache_read_input_tokens: 100000 })).toBeCloseTo((1 * 0.5 + 100000 * 0.05) / 1e6, 12);
    expect(haiku({ input_tokens: 1, cache_creation_input_tokens: 100000 })).toBeCloseTo((1 * 0.5 + 100000 * 0.625) / 1e6, 12);
    expect(haiku({ input_tokens: 50000, cache_read_input_tokens: 25000, cache_creation_input_tokens: 25000 })).toBeCloseTo((50000 * 0.1 + 25000 * 0.01 + 25000 * 0.125) / 1e6, 12);
  });

  it('un modelo sin tarifa de prompt largo no la aplica por muy largo que sea el prompt', () => {
    expect(cost(usage({ input_tokens: 500000 }, 'claude-opus-5-5'))).toBeCloseTo(2, 9);
  });
});

describe('messageCostUsd: el fallback del servidor', () => {
  const iterations = [
    { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 50 },
    { type: 'fallback_message', model: 'claude-sonnet-5-5', input_tokens: 1000, output_tokens: 500 },
  ];

  it('es el mayor de la cabecera y la suma de las iteraciones', () => {
    const message = usage({ input_tokens: 2000, output_tokens: 550, iterations }, 'claude-sonnet-5-5');
    expect(cost(message)).toBeCloseTo(0.012, 12);
    // Si la cabecera ya cuesta más que las iteraciones, gana la cabecera.
    const expensiveHeader = usage({ input_tokens: 2000, output_tokens: 550, iterations }, 'claude-opus-5-5');
    expect(cost(expensiveHeader)).toBeCloseTo((2000 * 4 + 550 * 20) / 1e6, 12);
  });

  it('una iteración sin modelo paga el precio más alto', () => {
    const message = usage({ input_tokens: 0, iterations: [{ input_tokens: 1000, output_tokens: 500 }] }, 'claude-haiku-5-5');
    expect(cost(message)).toBeCloseTo(0.014, 12);
  });

  it('sin iteraciones, o con una lista vacía o que no es una lista, es solo la cabecera', () => {
    for (const bad of [undefined, null, [], 'x', {}]) {
      expect(cost(usage({ input_tokens: 1000, output_tokens: 500, iterations: bad }, 'claude-sonnet-5-5'))).toBeCloseTo(0.007, 12);
    }
  });

  it('propiedad: el coste es finito, ≥ 0 y ≥ cada una de las dos cuentas', () => {
    const rand = prng(42);
    const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'otro', undefined] as const;
    const tokens = [0, 1, 7, 1000, 99999, 100000, 100001, 5_000_000, -3, 2.5, null];
    for (let i = 0; i < 2000; i++) {
      const piece = () => ({ input_tokens: pick(rand, tokens), output_tokens: pick(rand, tokens), cache_read_input_tokens: pick(rand, tokens), cache_creation_input_tokens: pick(rand, tokens) });
      const its = Array.from({ length: Math.floor(rand() * 3) }, () => ({ ...piece(), model: pick(rand, models) }));
      const message = { model: pick(rand, models), usage: { ...piece(), ...(its.length ? { iterations: its } : {}) } };
      const total = cost(message);
      const header = cost({ model: message.model, usage: { ...message.usage, iterations: undefined } });
      const summed = its.reduce((sum, it) => sum + cost({ model: it.model, usage: it }), 0);
      expect(Number.isFinite(total) && total >= 0).toBe(true);
      expect(total).toBeGreaterThanOrEqual(header - 1e-15);
      expect(total).toBeGreaterThanOrEqual(summed - 1e-15);
    }
  });

  it('contadores en 2^53 − 1 dan un coste finito, también con un precio enorme', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const big = resolveOptions({ models: { m: { prices: { inputUsdPerMTok: 1e308, outputUsdPerMTok: 1e308, cacheReadUsdPerMTok: 1e308, cacheWriteUsdPerMTok: 1e308 } } }, defaultModel: 'm' });
    const message = { model: 'm', usage: { input_tokens: max, output_tokens: max, cache_read_input_tokens: max, cache_creation_input_tokens: max } };
    const result = cost(message, big);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
    const defaults = cost({ model: 'claude-opus-5-5', usage: message.usage });
    expect(Number.isFinite(defaults)).toBe(true);
  });
});
