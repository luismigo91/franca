import { describe, expect, it } from 'vitest';
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL, DEFAULT_ANTHROPIC_MODELS } from '../../src/index.js';
import { apiError, fakeApi, fixture, ok, okMessage, turnRequest } from '../helpers/fake-api.js';

const TOLERANCE = 1e-12;

/** El coste de una respuesta de la API, a través del proveedor y del SDK reales. */
async function costOf(usage: Record<string, unknown>, model = 'claude-opus-5-5', requestModel: string | null = model, extra: Record<string, unknown> = {}): Promise<number> {
  const base = fixture('message-end-turn');
  const message = okMessage({ text: 'Hola' }, { model, usage: { ...(base.usage as object), ...usage, ...extra } });
  const provider = createAnthropicProvider({ client: fakeApi([{ body: message }]).client() });
  const result = await provider(turnRequest({ model: requestModel }));
  expect(result.kind).toBe('turn');
  return (result as { costUsd: number }).costUsd;
}

describe('Modelos permitidos', () => {
  const bodyModel = async (request: Parameters<typeof turnRequest>[0], options: Parameters<typeof createAnthropicProvider>[0] = {}) => {
    const api = fakeApi([ok()]);
    await createAnthropicProvider({ client: api.client(), ...options })(turnRequest(request));
    return api.calls.map((call) => call.body.model);
  };

  it('Modelo por defecto', async () => {
    expect(await bodyModel({ model: null })).toEqual(['claude-opus-5-5']);
  });

  it('Modelo del nodo', async () => {
    expect(await bodyModel({ model: 'claude-haiku-5-5' })).toEqual(['claude-haiku-5-5']);
  });

  it('Modelos que no están en la tabla', async () => {
    const api = fakeApi([ok()]);
    const provider = createAnthropicProvider({ client: api.client() });
    for (const model of ['claude-opus-5-5-20260101', 'Claude-Opus-5-5', 'gpt-x', '', 'constructor', 'toString', '__proto__']) {
      await expect(provider(turnRequest({ model })), JSON.stringify(model)).resolves.toEqual({ kind: 'not_configured' });
    }
    expect(api.calls).toHaveLength(0);
  });

  it('Tabla de la instalación', async () => {
    const api = fakeApi([ok()]);
    const provider = createAnthropicProvider({
      client: api.client(),
      models: { 'claude-haiku-5-5': DEFAULT_ANTHROPIC_MODELS['claude-haiku-5-5']! },
      defaultModel: 'claude-haiku-5-5',
    });
    await expect(provider(turnRequest({ model: 'claude-opus-5-5' }))).resolves.toEqual({ kind: 'not_configured' });
    expect(api.calls).toHaveLength(0);
    await provider(turnRequest({ model: null }));
    expect(api.calls.map((call) => call.body.model)).toEqual(['claude-haiku-5-5']);
  });
});

describe('Coste del turno', () => {
  it('Coste de Opus 5.5', async () => {
    const cost = await costOf({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400 });
    expect(Math.abs(cost - 0.0164)).toBeLessThan(TOLERANCE);
  });

  it('Coste de Sonnet 5.5', async () => {
    const cost = await costOf({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'claude-sonnet-5-5');
    expect(Math.abs(cost - 0.007)).toBeLessThan(TOLERANCE);
  });

  it('Respuesta de un modelo sin precio', async () => {
    const cost = await costOf({ input_tokens: 1000, output_tokens: 500 }, 'claude-otro', 'claude-opus-5-5');
    expect(Math.abs(cost - 0.014)).toBeLessThan(TOLERANCE);
  });

  it('Usage incompleto', async () => {
    const withoutCache = await costOf({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: undefined, cache_creation_input_tokens: undefined });
    expect(withoutCache).toBeCloseTo(0.014, 12);
    const nulls = await costOf({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: null, cache_creation_input_tokens: null });
    expect(nulls).toBeCloseTo(0.014, 12);
    for (const cost of [withoutCache, nulls]) expect(Number.isFinite(cost)).toBe(true);
  });
});

describe('Contadores de tokens', () => {
  it('Contadores fuera de rango', async () => {
    for (const input of [-1, 1.5, '1000']) {
      expect(await costOf({ input_tokens: input, output_tokens: 0 }), JSON.stringify(input)).toBe(0);
    }
    const huge = await costOf({ input_tokens: 9007199254740991, output_tokens: 0 });
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBeGreaterThan(0);
  });
});

describe('Coste con fallback del servidor', () => {
  it('Coste con fallback servido', async () => {
    const provider = createAnthropicProvider({ client: fakeApi([{ body: fixture('message-fallback') }]).client() });
    const result = await provider(turnRequest({ model: 'claude-opus-5-5' }));
    expect(result).toMatchObject({ kind: 'turn', text: 'Hola' });
    expect(Math.abs((result as { costUsd: number }).costUsd - 0.012)).toBeLessThan(TOLERANCE);
  });
});

describe('Tabla de precios por defecto', () => {
  it('Tabla por defecto exportada', () => {
    expect(Object.keys(DEFAULT_ANTHROPIC_MODELS)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(DEFAULT_ANTHROPIC_MODELS).toEqual({
      'claude-opus-5-5': {
        prices: { inputUsdPerMTok: 4, outputUsdPerMTok: 20, cacheReadUsdPerMTok: 0.2, cacheWriteUsdPerMTok: 5 },
        effort: 'low',
        serverFallback: true,
      },
      'claude-sonnet-5-5': {
        prices: { inputUsdPerMTok: 2, outputUsdPerMTok: 10, cacheReadUsdPerMTok: 0.2, cacheWriteUsdPerMTok: 2.5 },
        effort: 'low',
        serverFallback: true,
      },
      'claude-haiku-5-5': {
        prices: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5, cacheReadUsdPerMTok: 0.01, cacheWriteUsdPerMTok: 0.125 },
        longPrompt: {
          thresholdTokens: 100000,
          prices: { inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5, cacheReadUsdPerMTok: 0.05, cacheWriteUsdPerMTok: 0.625 },
        },
        effort: 'low',
      },
    });
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-opus-5-5');
    expect(Object.isFrozen(DEFAULT_ANTHROPIC_MODELS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ANTHROPIC_MODELS['claude-opus-5-5']!.prices)).toBe(true);
  });
});

describe('Tarifa de prompt largo', () => {
  it('Tarifas de Haiku 5.5', async () => {
    const base = await costOf({ input_tokens: 100000, output_tokens: 1000 }, 'claude-haiku-5-5');
    const long = await costOf({ input_tokens: 100001, output_tokens: 1000 }, 'claude-haiku-5-5');
    expect(Math.abs(base - 0.0105)).toBeLessThan(TOLERANCE);
    expect(Math.abs(long - 0.0525005)).toBeLessThan(TOLERANCE);
  });

  it('El umbral cuenta la caché', async () => {
    const cost = await costOf({ input_tokens: 60000, cache_read_input_tokens: 40001, output_tokens: 1000 }, 'claude-haiku-5-5');
    expect(Math.abs(cost - 0.03450005)).toBeLessThan(TOLERANCE);
  });
});

describe('Fallback de rechazo en el servidor', () => {
  const callWith = async (model: string, options: Parameters<typeof createAnthropicProvider>[0] = {}) => {
    const api = fakeApi([ok()]);
    await createAnthropicProvider({ client: api.client(), ...options })(turnRequest({ model }));
    return api.calls[0]!;
  };

  it('Fallback activado por defecto', async () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
      const call = await callWith(model);
      expect(call.url, model).toContain('/v1/messages?beta=true');
      expect(call.headers['anthropic-beta'], model).toBe('server-side-fallback-2026-07-01');
      expect(call.body.fallbacks, model).toBe('default');
      expect(call.body).not.toHaveProperty('betas');
    }
  });

  it('Haiku sin fallback', async () => {
    const call = await callWith('claude-haiku-5-5');
    expect(call.url).not.toContain('beta');
    expect(call.headers).not.toHaveProperty('anthropic-beta');
    expect(call.body).not.toHaveProperty('fallbacks');
    expect(call.body).not.toHaveProperty('betas');
  });

  it('Fallback desactivado', async () => {
    const call = await callWith('claude-opus-5-5', { serverFallback: false });
    expect(call.url).not.toContain('beta');
    expect(call.headers).not.toHaveProperty('anthropic-beta');
    expect(call.body).not.toHaveProperty('fallbacks');
  });

  it('Respuesta servida por el modelo de fallback', async () => {
    const cost = await costOf({ input_tokens: 1000, output_tokens: 500 }, 'claude-sonnet-5-5', 'claude-opus-5-5');
    expect(Math.abs(cost - 0.007)).toBeLessThan(TOLERANCE);
  });
});

describe('el coste de un fallo de la API es 0', () => {
  it('un error sin respuesta no cuesta nada', async () => {
    const provider = createAnthropicProvider({ client: fakeApi([apiError(500)]).client(), maxRetries: 0 });
    await expect(provider(turnRequest())).resolves.toEqual({ kind: 'failed', costUsd: 0 });
  });
});
