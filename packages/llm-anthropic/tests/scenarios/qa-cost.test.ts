import { describe, expect, it } from 'vitest';
import { messageCostUsd } from '../../src/cost.js';
import { createAnthropicProvider } from '../../src/index.js';
import { resolveOptions } from '../../src/options.js';
import { fakeApi, okMessage, turnRequest } from '../helpers/fake-api.js';
import { pick, prng } from '../helpers/prng.js';

/**
 * QA independiente del coste: un oráculo escrito desde la spec (tabla y reglas copiadas de ella, no
 * del código) contra 6000 respuestas al azar con contadores sanos y hostiles, y los bordes de la
 * tarifa de prompt largo de Haiku y del fallback del servidor.
 */

interface Prices { i: number; o: number; r: number; w: number }
const OPUS: Prices = { i: 4, o: 20, r: 0.2, w: 5 };
const SONNET: Prices = { i: 2, o: 10, r: 0.2, w: 2.5 };
const HAIKU: Prices = { i: 0.1, o: 0.5, r: 0.01, w: 0.125 };
const HAIKU_LONG: Prices = { i: 0.5, o: 2.5, r: 0.05, w: 0.625 };
/** «Si el modelo no está en la tabla, o falta, aplica a cada concepto el precio más alto de la tabla.» */
const HIGHEST: Prices = { i: 4, o: 20, r: 0.2, w: 5 };

const counter = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);

function oracle(usage: Record<string, unknown> | undefined, model: unknown): number {
  const i = counter(usage?.input_tokens);
  const o = counter(usage?.output_tokens);
  const r = counter(usage?.cache_read_input_tokens);
  const w = counter(usage?.cache_creation_input_tokens);
  let prices: Prices = HIGHEST;
  if (model === 'claude-opus-5-5') prices = OPUS;
  else if (model === 'claude-sonnet-5-5') prices = SONNET;
  else if (model === 'claude-haiku-5-5') prices = i + r + w > 100000 ? HAIKU_LONG : HAIKU;
  return (i * prices.i + o * prices.o + r * prices.r + w * prices.w) / 1e6;
}

function expectedCost(message: { model?: unknown; usage?: Record<string, any> }): number {
  const top = oracle(message.usage, message.model);
  const iterations = message.usage?.iterations;
  if (!Array.isArray(iterations) || iterations.length === 0) return top;
  const summed = iterations.reduce((total: number, entry: any) => total + oracle(entry, entry?.model), 0);
  return Math.max(top, summed);
}

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-otro', 'claude-opus-5-5-20260101', 'Claude-Opus-5-5', undefined, null, 7, ''] as const;
const COUNTS = [0, 1, 7, 999, 1000, 99999, 100000, 100001, 250000, 1_000_000, 9_007_199_254_740_991, -1, 1.5, '1000', null, undefined, true, [], {}] as const;

function randomUsage(rand: () => number): Record<string, unknown> {
  const usage: Record<string, unknown> = {};
  for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
    if (rand() < 0.9) usage[key] = pick(rand, COUNTS);
  }
  return usage;
}

describe('Coste del turno: oráculo de la spec', () => {
  const options = resolveOptions({});

  it('6000 respuestas al azar, con y sin fallback, coinciden con el oráculo', () => {
    const rand = prng(51);
    let withIterations = 0;
    for (let n = 0; n < 6000; n++) {
      const usage = randomUsage(rand);
      if (rand() < 0.4) {
        const count = Math.floor(rand() * 4);
        usage.iterations = Array.from({ length: count }, () => ({ type: 'message', model: pick(rand, MODELS), ...randomUsage(rand) }));
        if (count > 0) withIterations++;
      }
      const message = { model: pick(rand, MODELS), usage };
      const actual = messageCostUsd(message, options);
      const expected = expectedCost(message);
      expect(Number.isFinite(actual) && actual >= 0, `respuesta ${n}`).toBe(true);
      expect(actual, `respuesta ${n}: ${JSON.stringify(message)}`).toBeCloseTo(expected, 9);
      expect(Math.abs(actual - expected) <= 1e-9 * Math.max(1, expected), `respuesta ${n}`).toBe(true);
    }
    expect(withIterations).toBeGreaterThan(500);
  });

  it.each([
    ['100000 de entrada', { input_tokens: 100000, output_tokens: 1000 }, 0.0105],
    ['100001 de entrada', { input_tokens: 100001, output_tokens: 1000 }, 0.0525005],
    ['100000 repartidos entre entrada y lectura', { input_tokens: 50000, cache_read_input_tokens: 50000, output_tokens: 1000 }, 50000 * 0.1e-6 + 50000 * 0.01e-6 + 1000 * 0.5e-6],
    ['100001 repartidos entre entrada y lectura', { input_tokens: 50000, cache_read_input_tokens: 50001, output_tokens: 1000 }, 50000 * 0.5e-6 + 50001 * 0.05e-6 + 1000 * 2.5e-6],
    ['100001 solo de escritura de caché', { cache_creation_input_tokens: 100001 }, 100001 * 0.625e-6],
    ['100000 solo de escritura de caché', { cache_creation_input_tokens: 100000 }, 100000 * 0.125e-6],
    ['la salida no cuenta para el umbral', { input_tokens: 1, output_tokens: 500000 }, 1 * 0.1e-6 + 500000 * 0.5e-6],
  ])('Haiku: %s', (_label, usage, expected) => {
    expect(messageCostUsd({ model: 'claude-haiku-5-5', usage }, options)).toBeCloseTo(expected, 12);
  });

  it('Opus y Sonnet no tienen tarifa de prompt largo', () => {
    expect(messageCostUsd({ model: 'claude-opus-5-5', usage: { input_tokens: 500000 } }, options)).toBeCloseTo(2, 12);
    expect(messageCostUsd({ model: 'claude-sonnet-5-5', usage: { input_tokens: 500000 } }, options)).toBeCloseTo(1, 12);
  });

  it('con fallback el umbral de Haiku se evalúa por iteración, no por la suma', () => {
    const message = {
      model: 'claude-haiku-5-5',
      usage: {
        input_tokens: 150000,
        output_tokens: 0,
        iterations: [
          { type: 'message', model: 'claude-haiku-5-5', input_tokens: 60000, output_tokens: 0 },
          { type: 'fallback_message', model: 'claude-haiku-5-5', input_tokens: 90000, output_tokens: 0 },
        ],
      },
    };
    // Cabecera: 150000 > umbral → 0.075. Iteraciones: 60000 y 90000 a tarifa base → 0.015. Manda el mayor.
    expect(messageCostUsd(message, options)).toBeCloseTo(0.075, 12);
  });

  it('el fallback servido por Sonnet con una cabecera que suma los saltos nunca cuesta menos que las iteraciones', () => {
    const message = {
      model: 'claude-sonnet-5-5',
      usage: {
        input_tokens: 100,
        output_tokens: 100,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 100_000 },
          { type: 'fallback_message', model: 'claude-sonnet-5-5', input_tokens: 1_000_000, output_tokens: 100_000 },
        ],
      },
    };
    expect(messageCostUsd(message, options)).toBeCloseTo(4 + 2 + 2 + 1, 9);
  });

  it('una entrada de iterations que no es un objeto, o con model desconocido, no baja el coste', () => {
    const message = { model: 'claude-opus-5-5', usage: { input_tokens: 0, iterations: [null, 5, 'x', [], { type: 'message', input_tokens: 1_000_000 }] } };
    expect(messageCostUsd(message, options)).toBeCloseTo(4, 12);
  });

  it('un precio enorme de la instalación no da Infinity ni NaN', () => {
    const huge = { inputUsdPerMTok: 1.7e308, outputUsdPerMTok: 1.7e308, cacheReadUsdPerMTok: 1.7e308, cacheWriteUsdPerMTok: 1.7e308 };
    const table = resolveOptions({ models: { enorme: { prices: huge } } });
    const cost = messageCostUsd({ model: 'enorme', usage: { input_tokens: 9_007_199_254_740_991, output_tokens: 9_007_199_254_740_991 } }, table);
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
  });
});

describe('Coste del turno a través del proveedor y de cada motivo de parada', () => {
  const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400 };
  const cost = 0.0164;
  const run = async (overrides: Record<string, unknown>) => {
    const api = fakeApi([{ body: okMessage({}, { usage, ...overrides }) }]);
    return createAnthropicProvider({ client: api.client() })(turnRequest());
  };

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'failed'],
    ['pause_turn', 'failed'],
    ['model_context_window_exceeded', 'failed'],
    ['tool_use', 'failed'],
    ['stop_sequence', 'failed'],
    ['REFUSAL', 'failed'],
    ['end_turn ', 'failed'],
    [null, 'failed'],
    [undefined, 'failed'],
    [5, 'failed'],
  ])('stop_reason %j da %s con el coste de su usage', async (stop_reason, kind) => {
    expect(await run({ stop_reason })).toEqual({ kind, costUsd: expect.closeTo(cost, 12) });
  });

  it('un end_turn con la salida rota cuesta lo que dice su usage', async () => {
    const api = fakeApi([{ body: okMessage({}, { usage, content: [{ type: 'text', text: '{"text":' }] }) }]);
    expect(await createAnthropicProvider({ client: api.client() })(turnRequest())).toEqual({ kind: 'failed', costUsd: expect.closeTo(cost, 12) });
  });

  it('un end_turn sin usage cuesta 0 y sigue siendo un turno', async () => {
    const body = okMessage({});
    delete body.usage;
    const api = fakeApi([{ body }]);
    expect(await createAnthropicProvider({ client: api.client() })(turnRequest())).toMatchObject({ kind: 'turn', costUsd: 0 });
  });
});
