import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicClient, createAnthropicProvider } from '../../src/index.js';
import { apiError, fakeApi, fixture, ok, okMessage, spyOnConsole, turnRequest, type ApiStep } from '../helpers/fake-api.js';

/**
 * QA independiente: errores de la API, tiempo, concurrencia y entorno, con el SDK real y un `fetch`
 * falso (sin red). Los textos `MARCA-…` no deben salir nunca del proveedor.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const FAILED = { kind: 'failed', costUsd: 0 } as const;

describe('Estado HTTP → resultado, sin reintentos', () => {
  const STATUSES = [400, 401, 402, 403, 404, 405, 408, 409, 413, 422, 429, 500, 502, 503, 504, 529] as const;

  it.each(STATUSES)('status %i con el cuerpo de error de la API', async (status) => {
    const body = { type: 'error', error: { type: 'x', message: 'MARCA-ERROR' }, request_id: 'MARCA-REQ' };
    const api = fakeApi([{ status, body }]);
    const result = await createAnthropicProvider({ client: api.client(), maxRetries: 0 })(turnRequest());
    expect(result).toEqual([401, 403, 404].includes(status) ? { kind: 'not_configured' } : FAILED);
    expect(JSON.stringify(result)).not.toContain('MARCA');
    expect(api.calls).toHaveLength(1);
  });

  it.each([
    ['HTML', '<html>MARCA-HTML</html>', 'text/html'],
    ['texto plano', 'MARCA-TEXTO', 'text/plain'],
    ['vacío', '', 'application/json'],
    ['JSON que no es un error', '{"MARCA":"x"}', 'application/json'],
    ['array JSON', '["MARCA"]', 'application/json'],
    ['JSON roto', '{"error":{"message":"MARCA', 'application/json'],
  ])('un 500 y un 401 con cuerpo %s', async (_label, text, contentType) => {
    for (const status of [500, 401]) {
      const fetch = (async () => new Response(text, { status, headers: { 'content-type': contentType } })) as typeof globalThis.fetch;
      const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetch });
      const result = await createAnthropicProvider({ client, maxRetries: 0 })(turnRequest());
      expect(result).toEqual(status === 401 ? { kind: 'not_configured' } : FAILED);
      expect(JSON.stringify(result)).not.toContain('MARCA');
    }
  });

  it.each([
    ['vacío', ''],
    ['no es JSON', 'no soy json MARCA'],
    ['HTML', '<html>MARCA</html>'],
    ['un array', '[]'],
    ['null', 'null'],
    ['un objeto vacío', '{}'],
    ['un string', '"MARCA"'],
  ])('un 200 cuyo cuerpo es %s da failed sin coste y sin filtrar', async (_label, text) => {
    const fetch = (async () => new Response(text, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;
    const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetch });
    const result = await createAnthropicProvider({ client, maxRetries: 0 })(turnRequest());
    expect(result).toEqual(FAILED);
  });

  it('un cuerpo que se corta a mitad de lectura da failed', async () => {
    const fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":"msg_1","type":"mess'));
          controller.error(new Error('MARCA-CORTE'));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetch });
    const result = await createAnthropicProvider({ client, maxRetries: 0 })(turnRequest());
    expect(result).toEqual(FAILED);
  });
});

describe('Reintentos del SDK: cuántas peticiones y con qué tope', () => {
  const quick = (status: number): ApiStep => ({ status, body: fixture('error-500-api_error'), headers: { 'retry-after-ms': '1' } });

  it.each([
    [400, 1],
    [401, 1],
    [403, 1],
    [404, 1],
    [422, 1],
    [408, 3],
    [409, 3],
    [429, 3],
    [500, 3],
    [502, 3],
    [529, 3],
  ])('status %i con maxRetries 2 hace %i peticiones', async (status, calls) => {
    const api = fakeApi([quick(status)]);
    await createAnthropicProvider({ client: api.client(), maxRetries: 2 })(turnRequest());
    expect(api.calls).toHaveLength(calls);
  });

  it('un 401 con x-should-retry true no cambia la clasificación', async () => {
    const api = fakeApi([{ status: 401, body: fixture('error-401-authentication_error'), headers: { 'x-should-retry': 'true', 'retry-after-ms': '1' } }]);
    const result = await createAnthropicProvider({ client: api.client(), maxRetries: 1 })(turnRequest());
    expect(result).toEqual({ kind: 'not_configured' });
  });

  it('un 429 que pide esperar mucho no alarga el turno más allá de turnTimeoutMs', async () => {
    const api = fakeApi([{ status: 429, body: fixture('error-429-rate_limit_error'), headers: { 'retry-after': '30' } }]);
    const started = performance.now();
    const result = await createAnthropicProvider({ client: api.client(), maxRetries: 2, turnTimeoutMs: 150 })(turnRequest());
    expect(result).toEqual(FAILED);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(api.calls).toHaveLength(1);
  });

  it('el éxito tras un error transitorio cuenta solo el coste de la respuesta buena', async () => {
    const api = fakeApi([quick(529), ok({ text: 'Hola' })]);
    const result = await createAnthropicProvider({ client: api.client(), maxRetries: 2 })(turnRequest());
    expect(result).toMatchObject({ kind: 'turn', costUsd: expect.closeTo(0.006, 10) });
  });
});

describe('Tiempo por turno', () => {
  it('una respuesta que llega después de vencer el plazo no cambia el resultado ni deja un rechazo sin atender', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      let late: () => void = () => {};
      const fetch = (() => new Promise<Response>((resolve) => void (late = () => resolve(new Response(JSON.stringify(okMessage({ text: 'TARDE' })), { status: 200, headers: { 'content-type': 'application/json' } }))))) as typeof globalThis.fetch;
      const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetch });
      const result = await createAnthropicProvider({ client, turnTimeoutMs: 30, maxRetries: 0 })(turnRequest());
      expect(result).toEqual(FAILED);
      late();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('un fetch que rechaza después de vencer el plazo tampoco deja un rechazo sin atender', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      let fail: () => void = () => {};
      const fetch = (() => new Promise<Response>((_resolve, reject) => void (fail = () => reject(new Error('MARCA-TARDE'))))) as typeof globalThis.fetch;
      const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetch });
      const result = await createAnthropicProvider({ client, turnTimeoutMs: 30, maxRetries: 0 })(turnRequest());
      expect(result).toEqual(FAILED);
      fail();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('el proveedor no deja temporizadores propios tras un turno (éxito, error de API, conexión ni plazo)', async () => {
    vi.useFakeTimers();
    const steps: ApiStep[] = [ok({ text: 'Hola' }), apiError(401), apiError(400), 'network-error'];
    for (const step of steps) {
      const api = fakeApi([step]);
      await createAnthropicProvider({ client: api.client(), maxRetries: 0, turnTimeoutMs: 60_000 })(turnRequest());
      expect(vi.getTimerCount(), JSON.stringify(step).slice(0, 40)).toBe(0);
    }
    const api = fakeApi(['hang-ignoring-signal']);
    const pending = createAnthropicProvider({ client: api.client(), maxRetries: 0, turnTimeoutMs: 1000 })(turnRequest());
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual(FAILED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1, 2_147_483_647])('turnTimeoutMs %i es válido y el turno termina', async (turnTimeoutMs) => {
    const api = fakeApi([ok({ text: 'Hola' })]);
    const result = await createAnthropicProvider({ client: api.client(), turnTimeoutMs })(turnRequest());
    // Con 1 ms puede vencer antes que la respuesta: lo que no puede ser es otra cosa que un resultado del contrato.
    expect(['turn', 'failed']).toContain(result.kind);
  });
});

describe('Concurrencia: un proveedor compartido no mezcla turnos', () => {
  it('40 turnos a la vez, con retardos distintos, devuelven cada uno su texto, su modelo y su coste', async () => {
    const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; messages: { content: { text: string }[] }[] };
      const marker = body.messages.at(-1)!.content[0]!.text;
      // Retardo determinista y distinto por turno: las respuestas llegan en otro orden que las peticiones.
      await new Promise((resolve) => setTimeout(resolve, (marker.length * 7) % 25));
      const reply = okMessage({ text: `eco ${marker}`, slots: { s0: null, s1: null } }, { model: body.model, usage: { input_tokens: marker.length * 1000, output_tokens: 0 } });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetch });
    const provider = createAnthropicProvider({ client });
    const jobs = Array.from({ length: 40 }, (_, i) => {
      const model = models[i % 3]!;
      const marker = `m${'x'.repeat(i)}`;
      return provider(turnRequest({ model, history: [{ role: 'assistant', text: 'a' }, { role: 'user', text: marker }], turn: 2 })).then((result) => ({ result, model, marker }));
    });
    const prices = { 'claude-opus-5-5': 4, 'claude-sonnet-5-5': 2, 'claude-haiku-5-5': 0.1 };
    for (const { result, model, marker } of await Promise.all(jobs)) {
      expect(result).toMatchObject({ kind: 'turn', text: `eco ${marker}` });
      expect((result as { costUsd: number }).costUsd).toBeCloseTo((marker.length * 1000 * prices[model]) / 1e6, 12);
    }
  });

  it('un turno que vence no afecta a los demás en vuelo', async () => {
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: { text: string }[] }[] };
      if (body.messages.at(-1)!.content[0]!.text === 'cuelga') return new Promise<Response>(() => {});
      return new Response(JSON.stringify(okMessage({ text: 'bien' })), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const provider = createAnthropicProvider({ client: createAnthropicClient({ apiKey: 'clave-de-prueba', fetch }), turnTimeoutMs: 40, maxRetries: 0 });
    const request = (text: string) => turnRequest({ history: [{ role: 'assistant', text: 'a' }, { role: 'user', text }], turn: 2 });
    const results = await Promise.all([provider(request('cuelga')), provider(request('uno')), provider(request('dos'))]);
    expect(results.map((r) => r.kind)).toEqual(['failed', 'turn', 'turn']);
  });
});

const thenableThatThrows = (): unknown => ({
  then: () => {
    throw new Error('MARCA');
  },
});

describe('Errores y peticiones raras: la promesa nunca se rechaza', () => {
  const clientThrowing = (thrown: () => unknown) => ({ messages: { create: () => { throw thrown(); } }, beta: { messages: { create: () => { throw thrown(); } } } }) as never;
  const clientRejecting = (value: () => unknown) => ({ messages: { create: () => Promise.reject(value()) }, beta: { messages: { create: () => Promise.reject(value()) } } }) as never;

  it.each([
    ['status 401', () => ({ status: 401 }), { kind: 'not_configured' }],
    ['status 403', () => ({ status: 403 }), { kind: 'not_configured' }],
    ['status 404', () => ({ status: 404 }), { kind: 'not_configured' }],
    ['status "401" (string)', () => ({ status: '401' }), FAILED],
    ['status 401.5', () => ({ status: 401.5 }), FAILED],
    ['status 500', () => ({ status: 500 }), FAILED],
    ['un string', () => 'MARCA', FAILED],
    ['undefined', () => undefined, FAILED],
    ['null', () => null, FAILED],
    ['un símbolo', () => Symbol('MARCA'), FAILED],
    ['un bigint', () => 10n, FAILED],
    ['un objeto sin prototipo', () => Object.create(null), FAILED],
    ['un Proxy cuya lectura lanza', () => new Proxy({}, { get: () => { throw new Error('MARCA'); } }), FAILED],
    ['un getter de status que lanza', () => ({ get status(): never { throw new Error('MARCA'); } }), FAILED],
    ['un Error con message sensible', () => new Error('MARCA-SECRETO'), FAILED],
  ])('el cliente lanza o rechaza con %s', async (_label, thrown, expected) => {
    for (const client of [clientThrowing(thrown), clientRejecting(thrown)]) {
      for (const model of ['claude-haiku-5-5', 'claude-opus-5-5']) {
        const result = await createAnthropicProvider({ client })(turnRequest({ model }));
        expect(result).toEqual(expected);
        expect(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? '0' : v))).not.toContain('MARCA');
      }
    }
  });

  it.each([
    ['sin messages', {}],
    ['messages sin create', { messages: {}, beta: { messages: {} } }],
    ['create devuelve undefined', { messages: { create: () => undefined }, beta: { messages: { create: () => undefined } } }],
    ['create devuelve un string', { messages: { create: () => 'x' }, beta: { messages: { create: () => 'x' } } }],
    ['create devuelve un thenable que lanza', { messages: { create: () => thenableThatThrows() }, beta: { messages: { create: () => thenableThatThrows() } } }],
  ])('un cliente defectuoso (%s) da failed', async (_label, client) => {
    for (const model of ['claude-haiku-5-5', 'claude-opus-5-5']) {
      expect(await createAnthropicProvider({ client: client as never })(turnRequest({ model }))).toEqual(FAILED);
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['un objeto vacío', {}],
    ['slots no es un array', { ...turnRequest(), slots: 'x' }],
    ['history no es un array', { ...turnRequest(), history: null }],
    ['un slot null', { ...turnRequest(), slots: [null] }],
    ['un modelo que no es un string', { ...turnRequest(), model: 5 }],
    ['un getter que lanza', { ...turnRequest(), get goal(): never { throw new Error('MARCA'); } }],
    ['un tipo de slot desconocido', { ...turnRequest(), slots: [{ name: 'x', type: 'inventado', description: 'd', required: true, collected: false }] }],
  ])('una petición rara (%s) no rechaza la promesa', async (_label, request) => {
    const api = fakeApi([ok({ text: 'Hola' })]);
    const result = await createAnthropicProvider({ client: api.client() })(request as never);
    expect(['turn', 'failed', 'not_configured']).toContain(result.kind);
    expect(JSON.stringify(result)).not.toContain('MARCA');
  });
});

describe('Cliente por defecto y entorno de la máquina', () => {
  it('sin client: usa el entorno, nunca registra aunque ANTHROPIC_LOG sea debug y no sale a la red', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'clave-de-prueba');
    vi.stubEnv('ANTHROPIC_LOG', 'debug');
    vi.stubEnv('ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE', 'content');
    const spies = spyOnConsole();
    const api = fakeApi([ok({ text: 'Hola' })]);
    vi.stubGlobal('fetch', api.fetch);
    const provider = createAnthropicProvider();
    const history = [{ role: 'assistant', text: 'MARCA-HISTORIAL' }, { role: 'user', text: 'MARCA-HISTORIAL' }] as const;
    const result = await provider(turnRequest({ history: [...history], turn: 2 }));
    expect(result).toMatchObject({ kind: 'turn', text: 'Hola' });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.headers['x-api-key']).toBe('clave-de-prueba');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // Ni siquiera con un error de la API en medio.
    const failing = fakeApi([apiError(500)]);
    vi.stubGlobal('fetch', failing.fetch);
    expect(await createAnthropicProvider({ maxRetries: 0 })(turnRequest({ history: [...history], turn: 2 }))).toEqual(FAILED);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('sin credenciales en el entorno el turno falla antes de enviar nada', async () => {
    const api = fakeApi([ok({ text: 'Hola' })]);
    vi.stubGlobal('fetch', api.fetch);
    const result = await createAnthropicProvider()(turnRequest());
    expect(result).toEqual(FAILED);
    expect(api.calls).toHaveLength(0);
  });

  it('el entorno no cambia el cuerpo: una URL base del entorno solo cambia a dónde va', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'clave-de-prueba');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://proxy.invalid/');
    const api = fakeApi([ok({ text: 'Hola' })]);
    vi.stubGlobal('fetch', api.fetch);
    await createAnthropicProvider()(turnRequest());
    expect(api.calls[0]!.url.startsWith('https://proxy.invalid/')).toBe(true);
    const reference = fakeApi([ok({ text: 'Hola' })]);
    await createAnthropicProvider({ client: reference.client() })(turnRequest());
    expect(api.calls[0]!.body).toEqual(reference.calls[0]!.body);
  });
});
