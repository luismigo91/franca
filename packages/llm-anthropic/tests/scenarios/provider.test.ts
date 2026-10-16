import { createLlmCapability, startSession } from '@franca/engine';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from '../../src/index.js';
import { apiError, fakeApi, fixture, ok, okMessage, quickRetry, spyOnConsole, turnRequest } from '../helpers/fake-api.js';

const faqIa = (): unknown => JSON.parse(readFileSync(new URL('../../../spec/examples/faq-ia.json', import.meta.url), 'utf8'));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Proveedor de Claude', () => {
  it('Primer turno de faq-ia con Claude', async () => {
    const message = okMessage({ text: '¿En qué puedo ayudarte?', done: false, slots: { s0: null, s1: null } });
    const api = fakeApi([{ body: message }]);
    const llm = createLlmCapability({ principal: createAnthropicProvider({ client: api.client() }) });
    const result = await startSession({ flow: faqIa() }, { llm });
    expect(result.ok && result.status).toBe('waiting');
    if (!result.ok) return;
    expect(result.events.filter((e) => e.type === 'message').at(-1)).toMatchObject({
      nodeId: 'asistente',
      content: [{ kind: 'text', text: '¿En qué puedo ayudarte?' }],
    });
    expect(api.calls).toHaveLength(1);
  });

  it('El proveedor no rechaza nunca', async () => {
    const throwing = () => {
      throw new TypeError('MARCA-ERROR');
    };
    const rejecting = () => Promise.reject({ not: 'an error', text: 'MARCA-ERROR' });
    for (const create of [throwing, rejecting]) {
      const client = { messages: { create }, beta: { messages: { create } } };
      for (const model of ['claude-haiku-5-5', 'claude-opus-5-5']) {
        const provider = createAnthropicProvider({ client: client as never });
        await expect(provider(turnRequest({ model }))).resolves.toEqual({ kind: 'failed', costUsd: 0 });
      }
    }
  });

  it('Callbacks que lanzan', async () => {
    const api = fakeApi([ok({ text: 'Hola', slots: { s0: null, s1: null } })]);
    const provider = createAnthropicProvider({
      client: api.client(),
      onWarning: () => {
        throw new Error('MARCA-CALLBACK');
      },
    });
    const result = await provider(turnRequest({ temperature: 0.2 }));
    expect(result).toMatchObject({ kind: 'turn', text: 'Hola' });
  });
});

describe('Resultados compartidos', () => {
  it('failed y not_configured están congelados: mutar el de un turno no cambia los siguientes', async () => {
    const failing = createAnthropicProvider({ client: fakeApi([apiError(500)]).client(), maxRetries: 0 });
    const missing = createAnthropicProvider({ client: fakeApi([apiError(401)]).client(), maxRetries: 0 });
    for (const provider of [failing, missing]) {
      const first = await provider(turnRequest());
      expect(Object.isFrozen(first)).toBe(true);
      expect(() => {
        (first as { kind: string }).kind = 'turn';
      }).toThrow(TypeError);
    }
    expect(await failing(turnRequest())).toEqual({ kind: 'failed', costUsd: 0 });
    expect(await missing(turnRequest())).toEqual({ kind: 'not_configured' });
  });
});

describe('Cliente y credenciales', () => {
  it('Cliente inyectado', async () => {
    const stable = vi.fn(() => Promise.resolve(okMessage({ text: 'Hola' })));
    const beta = vi.fn(() => Promise.resolve(okMessage({ text: 'Hola' })));
    const globalFetch = vi.fn(() => Promise.reject(new Error('sin red')));
    vi.stubGlobal('fetch', globalFetch);
    const provider = createAnthropicProvider({ client: { messages: { create: stable }, beta: { messages: { create: beta } } } as never });
    const result = await provider(turnRequest({ model: 'claude-haiku-5-5' }));
    expect(result.kind).toBe('turn');
    expect(stable).toHaveBeenCalledTimes(1);
    expect(beta).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('Cliente por defecto sin credenciales', async () => {
    for (const name of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_CUSTOM_HEADERS',
      'ANTHROPIC_CONFIG_DIR',
      'ANTHROPIC_PROFILE',
      'ANTHROPIC_IDENTITY_TOKEN_FILE',
    ]) {
      vi.stubEnv(name, '');
    }
    const home = mkdtempSync(join(tmpdir(), 'franca-llm-anthropic-'));
    vi.stubEnv('XDG_CONFIG_HOME', home);
    vi.stubEnv('HOME', home);
    const globalFetch = vi.fn(() => Promise.reject(new Error('sin red')));
    vi.stubGlobal('fetch', globalFetch);
    const provider = createAnthropicProvider();
    await expect(provider(turnRequest())).resolves.toEqual({ kind: 'failed', costUsd: 0 });
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('Credenciales rechazadas', async () => {
    const warnings: unknown[] = [];
    const api = fakeApi([{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'MARCA-CREDENCIAL' }, request_id: 'req_1' } }]);
    const provider = createAnthropicProvider({ client: api.client({ maxRetries: 0 }), maxRetries: 0, onWarning: (w) => void warnings.push(w) });
    const result = await provider(turnRequest({ temperature: 0.2 }));
    expect(result).toEqual({ kind: 'not_configured' });
    expect(JSON.stringify([result, warnings])).not.toContain('MARCA-CREDENCIAL');
  });
});

describe('Errores de la API', () => {
  it('Errores por status', async () => {
    const expected = { 401: 'not_configured', 403: 'not_configured', 404: 'not_configured', 400: 'failed', 429: 'failed', 500: 'failed', 529: 'failed' } as const;
    for (const [status, kind] of Object.entries(expected)) {
      const api = fakeApi([apiError(Number(status) as 401)]);
      const provider = createAnthropicProvider({ client: api.client(), maxRetries: 0 });
      const result = await provider(turnRequest());
      expect(result, status).toEqual(kind === 'failed' ? { kind: 'failed', costUsd: 0 } : { kind: 'not_configured' });
      expect(JSON.stringify(result)).not.toContain('MARCA-ERROR');
    }
  });

  it('Fallo de conexión', async () => {
    const api = fakeApi(['network-error']);
    const provider = createAnthropicProvider({ client: api.client(), maxRetries: 0 });
    await expect(provider(turnRequest())).resolves.toEqual({ kind: 'failed', costUsd: 0 });
  });
});

describe('Reintentos y tiempo por turno', () => {
  it('Reintento transitorio', async () => {
    const api = fakeApi([quickRetry(429), ok({ text: 'Hola' })]);
    const provider = createAnthropicProvider({ client: api.client(), maxRetries: 1 });
    const result = await provider(turnRequest());
    expect(result.kind).toBe('turn');
    expect(api.calls).toHaveLength(2);
  });

  it('Reintentos agotados', async () => {
    const api = fakeApi([quickRetry(529)]);
    const provider = createAnthropicProvider({ client: api.client(), maxRetries: 2 });
    await expect(provider(turnRequest())).resolves.toEqual({ kind: 'failed', costUsd: 0 });
    expect(api.calls).toHaveLength(3);
  });

  it('Tiempo total por turno', async () => {
    vi.useFakeTimers();
    for (const step of ['hang', 'hang-ignoring-signal'] as const) {
      const api = fakeApi([step]);
      const provider = createAnthropicProvider({ client: api.client(), turnTimeoutMs: 500 });
      let settled: unknown;
      void provider(turnRequest()).then((result) => void (settled = result));
      await vi.advanceTimersByTimeAsync(499);
      expect(settled, `${step} a los 499 ms`).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled, `${step} a los 500 ms`).toEqual({ kind: 'failed', costUsd: 0 });
      expect(api.calls[0]!.signal?.aborted, `${step}: señal abortada`).toBe(true);
    }
  });
});

describe('Privacidad del proveedor', () => {
  it('Sin consola', async () => {
    const spies = spyOnConsole();
    const cases: [string, Parameters<typeof fakeApi>[0][number]][] = [
      ['turn', ok({ text: 'Hola' })],
      ['refusal', { body: fixture('message-refusal') }],
      ['failed por status', apiError(500)],
      ['failed por conexión', 'network-error'],
      ['not_configured', apiError(401)],
    ];
    for (const [, step] of cases) {
      const provider = createAnthropicProvider({ client: fakeApi([step]).client(), maxRetries: 0 });
      await provider(turnRequest({ temperature: 0.2 }));
    }
    // Por tiempo, con un plazo corto de verdad.
    await createAnthropicProvider({ client: fakeApi(['hang']).client(), turnTimeoutMs: 20 })(turnRequest());
    expect(spies.length).toBeGreaterThan(5);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('Aviso sin contenido', async () => {
    const warnings: unknown[] = [];
    const api = fakeApi([ok({ text: 'MARCA-RESPUESTA' })]);
    const provider = createAnthropicProvider({ client: api.client(), onWarning: (warning) => void warnings.push(warning) });
    await provider(turnRequest({ temperature: 0.2, history: [{ role: 'assistant', text: 'MARCA-HISTORIAL' }, { role: 'user', text: 'MARCA-HISTORIAL' }], turn: 2 }));
    expect(warnings).toHaveLength(1);
    const text = JSON.stringify(warnings);
    expect(text).not.toContain('MARCA-HISTORIAL');
    expect(text).not.toContain('MARCA-RESPUESTA');
  });
});
