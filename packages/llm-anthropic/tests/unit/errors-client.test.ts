import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicClient } from '../../src/client.js';
import { classifyError } from '../../src/errors.js';
import { fakeApi } from '../helpers/fake-api.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('classifyError', () => {
  it.each([
    [401, 'not_configured'],
    [403, 'not_configured'],
    [404, 'not_configured'],
    [400, 'failed'],
    [402, 'failed'],
    [408, 'failed'],
    [409, 'failed'],
    [413, 'failed'],
    [422, 'failed'],
    [429, 'failed'],
    [500, 'failed'],
    [529, 'failed'],
    ['401', 'failed'],
    [undefined, 'failed'],
    [null, 'failed'],
  ])('status %j → %s', (status, kind) => {
    expect(classifyError({ status })).toBe(kind);
  });

  it.each([undefined, null, 'error', 5, new TypeError('fetch failed'), {}, []])('un valor sin status (%j) es failed', (error) => {
    expect(classifyError(error)).toBe('failed');
  });

  it('solo lee status: message, el cuerpo y las cabeceras no se tocan', () => {
    let reads = 0;
    const error = {
      status: 401,
      get message() {
        reads++;
        return 'MARCA-ERROR';
      },
      get error() {
        reads++;
        return { error: { message: 'MARCA-ERROR' } };
      },
      get headers() {
        reads++;
        return {};
      },
    };
    expect(classifyError(error)).toBe('not_configured');
    expect(reads).toBe(0);
  });

  it('un getter de status que lanza es failed, no una excepción', () => {
    const error = {
      get status(): never {
        throw new Error('MARCA-ERROR');
      },
    };
    expect(classifyError(error)).toBe('failed');
  });

  it('una instancia de APIError del SDK real se clasifica por su status', async () => {
    const api = fakeApi([{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'x' } } }]);
    const error = await api.client({ maxRetries: 0 }).messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e);
    expect((error as { status: number }).status).toBe(401);
    expect(classifyError(error)).toBe('not_configured');
  });
});

describe('createAnthropicClient', () => {
  const base = { apiKey: 'clave-de-prueba', fetch: fakeApi([{ body: {} }]).fetch };

  it('fuerza logLevel off aunque ANTHROPIC_LOG o las opciones digan otra cosa', () => {
    vi.stubEnv('ANTHROPIC_LOG', 'debug');
    expect(createAnthropicClient(base).logLevel).toBe('off');
    expect(createAnthropicClient({ ...base, logLevel: 'debug' }).logLevel).toBe('off');
  });

  it('fuerza las trazas de solo metadatos aunque el entorno o las opciones pidan contenido', () => {
    vi.stubEnv('ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE', 'content');
    expect(createAnthropicClient(base).openTelemetry.traces.contentMode).toBe('metadata_only');
    expect(createAnthropicClient({ ...base, openTelemetry: { traces: { contentMode: 'content' } } }).openTelemetry.traces.contentMode).toBe('metadata_only');
    expect(createAnthropicClient({ ...base, openTelemetry: { traces: true } }).openTelemetry.traces.contentMode).toBe('metadata_only');
  });

  it('openTelemetry: false se respeta, y conserva el resto de la opción', () => {
    expect(createAnthropicClient({ ...base, openTelemetry: false }).openTelemetry.traces.enabled).toBe(false);
    expect(createAnthropicClient({ ...base, openTelemetry: { traces: false } }).openTelemetry.traces.enabled).toBe(false);
    expect(createAnthropicClient({ ...base, openTelemetry: { traces: { enabled: false } } }).openTelemetry.traces.enabled).toBe(false);
    const kept = createAnthropicClient({ ...base, openTelemetry: { propagation: false, traces: { maxContentBytes: 1234 } } }).openTelemetry;
    expect(kept.propagation).toBe(false);
    expect(kept.traces.maxContentBytes).toBe(1234);
    expect(kept.traces.contentMode).toBe('metadata_only');
  });

  it('pasa el resto de las opciones al SDK (clave, fetch y reintentos)', async () => {
    const api = fakeApi([{ body: { id: 'x' } }]);
    const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetch: api.fetch, maxRetries: 0 });
    expect(client.maxRetries).toBe(0);
    await client.messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'x' }] });
    expect(api.calls[0]!.headers['x-api-key']).toBe('clave-de-prueba');
  });
});
