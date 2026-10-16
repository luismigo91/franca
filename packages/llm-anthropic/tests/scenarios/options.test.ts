import { describe, expect, it } from 'vitest';
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODELS } from '../../src/index.js';
import { fakeApi, ok, turnRequest } from '../helpers/fake-api.js';

const PRICES = { inputUsdPerMTok: 1, outputUsdPerMTok: 2, cacheReadUsdPerMTok: 0.1, cacheWriteUsdPerMTok: 1.25 };

describe('Tabla de modelos válida', () => {
  it('Tablas que no se pueden aplicar', () => {
    const api = fakeApi([ok()]);
    const client = api.client();
    const tables: Record<string, unknown> = {
      vacía: {},
      'sin tarifa base': { m: { effort: 'low' } },
      'precio de entrada -1': { m: { prices: { ...PRICES, inputUsdPerMTok: -1 } } },
      'precio de entrada NaN': { m: { prices: { ...PRICES, inputUsdPerMTok: Number.NaN } } },
      'umbral 0': { m: { prices: PRICES, longPrompt: { thresholdTokens: 0, prices: PRICES } } },
      'umbral 1.5': { m: { prices: PRICES, longPrompt: { thresholdTokens: 1.5, prices: PRICES } } },
      'effort minimal': { m: { prices: PRICES, effort: 'minimal' } },
    };
    for (const [name, models] of Object.entries(tables)) {
      expect(() => createAnthropicProvider({ client, models: models as never }), name).toThrow(TypeError);
    }
    expect(api.calls).toHaveLength(0);
  });

  it('los mensajes de error son fijos y no incluyen valores', () => {
    const attempts = [
      { m: { prices: { ...PRICES, inputUsdPerMTok: -987654 } } },
      { m: { prices: PRICES, effort: 'MARCA-EFFORT' } },
      { 'MARCA-MODELO': {} },
    ];
    for (const models of attempts) {
      let message = '';
      try {
        createAnthropicProvider({ client: fakeApi([ok()]).client(), models: models as never });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      for (const value of ['987654', 'MARCA-EFFORT', 'MARCA-MODELO']) expect(message).not.toContain(value);
    }
  });

  it('Tabla de la instalación ampliada', async () => {
    const api = fakeApi([ok()]);
    const models = { ...DEFAULT_ANTHROPIC_MODELS, 'claude-propio': { prices: PRICES } };
    const provider = createAnthropicProvider({ client: api.client(), models });
    await provider(turnRequest({ model: 'claude-propio' }));
    await provider(turnRequest({ model: 'claude-sonnet-5-5' }));
    expect(api.calls.map((call) => call.body.model)).toEqual(['claude-propio', 'claude-sonnet-5-5']);
  });

  it('mutar la tabla después de crear el proveedor no cambia sus precios', async () => {
    const models = { 'claude-propio': { prices: { ...PRICES } } };
    const api = fakeApi([ok({ text: 'Hola' }, { model: 'claude-propio', usage: { input_tokens: 1000000, output_tokens: 0 } })]);
    const provider = createAnthropicProvider({ client: api.client(), models, defaultModel: 'claude-propio' });
    models['claude-propio'].prices.inputUsdPerMTok = 100;
    const result = await provider(turnRequest());
    expect(result).toMatchObject({ kind: 'turn', costUsd: 1 });
  });
});

describe('Opciones válidas', () => {
  it('Opciones que no se pueden aplicar', () => {
    const api = fakeApi([ok()]);
    const client = api.client();
    const bad: [string, Parameters<typeof createAnthropicProvider>[0]][] = [
      ['maxOutputTokens 0', { maxOutputTokens: 0 }],
      ['turnTimeoutMs 1.5', { turnTimeoutMs: 1.5 }],
      ['turnTimeoutMs 2147483648', { turnTimeoutMs: 2147483648 }],
      ['maxRetries -1', { maxRetries: -1 }],
      ['onWarning "x"', { onWarning: 'x' as never }],
    ];
    for (const [name, options] of bad) expect(() => createAnthropicProvider({ client, ...options }), name).toThrow(TypeError);
    expect(api.calls).toHaveLength(0);
  });

  it('los valores límite válidos no lanzan', () => {
    const client = fakeApi([ok()]).client();
    expect(() => createAnthropicProvider({ client, maxOutputTokens: 1, turnTimeoutMs: 2147483647, maxRetries: 0 })).not.toThrow();
  });

  it('Modelo por defecto fuera de la tabla', async () => {
    const api = fakeApi([ok()]);
    const provider = createAnthropicProvider({ client: api.client(), models: { 'claude-haiku-5-5': DEFAULT_ANTHROPIC_MODELS['claude-haiku-5-5']! } });
    await expect(provider(turnRequest({ model: null }))).resolves.toEqual({ kind: 'not_configured' });
    expect(api.calls).toHaveLength(0);
  });
});
