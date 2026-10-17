import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmTurnRequest } from '@franca/engine';
import { createAnthropicClient, createAnthropicProvider } from '@franca/llm-anthropic';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION, createAnthropicEgress, createLlmProviders, createPrincipalClient, type Send } from './llm-providers.js';

/** Cabecera beta que el adaptador pone en la llamada con `fallbacks` (modelos con `serverFallback`). */
const ADAPTER_BETA = 'server-side-fallback-2026-07-01';
const KEY = 'clave-de-prueba';
const HOME = mkdtempSync(join(tmpdir(), 'franca-api-llm-env-'));

/** Las variables del SDK que podrían cambiar la clave, la URL o las cabeceras de una petición. */
const SDK_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'ANTHROPIC_LOG',
  'ANTHROPIC_OPEN_TELEMETRY',
];

interface Call {
  url: string;
  init: RequestInit;
}

/** Una red que registra la petición y responde un 400 sin enviar nada: el SDK no reintenta un 400. */
function recordingNetwork(): { send: Send; calls: Call[] } {
  const calls: Call[] = [];
  const send: Send = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'prueba' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { send, calls };
}

function turnRequest(model: string | null): LlmTurnRequest {
  return { nodeId: 'asistente', provider: 'principal', model, system: null, goal: 'Saluda.', slots: [], history: [], temperature: null, locale: 'es', turn: 1, maxTurns: 8 };
}

const headersOf = (call: Call | undefined): Record<string, string> => call?.init.headers as Record<string, string>;

beforeEach(() => {
  for (const name of SDK_VARIABLES) vi.stubEnv(name, '');
  vi.stubEnv('HOME', HOME);
  vi.stubEnv('XDG_CONFIG_HOME', HOME);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Hace un turno con el modelo por defecto y otro con `claude-haiku-5-5`; devuelve las peticiones que salieron y los resultados. */
async function twoTurns(client: ReturnType<typeof createAnthropicClient>, network: ReturnType<typeof recordingNetwork>) {
  const provider = createAnthropicProvider({ client, maxRetries: 0 });
  const results = [await provider(turnRequest(null)), await provider(turnRequest('claude-haiku-5-5'))];
  return { calls: network.calls, results };
}

describe('cliente de Claude de la API', () => {
  it('Cliente con la configuración explícita', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-no-usar');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-no-usar');
    const client = createPrincipalClient(KEY, recordingNetwork().send);
    expect(client.apiKey).toBe(KEY);
    expect(client.baseURL).toBe('https://api.anthropic.com');
    expect(client.authToken).toBeNull();
  });

  it('Cabeceras del entorno ignoradas', async () => {
    const clean = recordingNetwork();
    const baseline = await twoTurns(createPrincipalClient(KEY, clean.send), clean);

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-no-usar');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-no-usar');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'x-api-key: otra-clave\nAuthorization: Bearer otro-token\nanthropic-beta: otra-beta\nX-Extra: 1');
    const polluted = recordingNetwork();
    const { calls } = await twoTurns(createPrincipalClient(KEY, polluted.send), polluted);

    expect(calls.map((call) => call.url)).toEqual(['https://api.anthropic.com/v1/messages?beta=true', 'https://api.anthropic.com/v1/messages']);
    expect(headersOf(calls[0])).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      'x-api-key': KEY,
      'anthropic-beta': ADAPTER_BETA,
    });
    expect(headersOf(calls[1])).toEqual({ accept: 'application/json', 'content-type': 'application/json', 'anthropic-version': ANTHROPIC_API_VERSION, 'x-api-key': KEY });
    // Idénticas a las del mismo turno sin esas variables.
    expect(calls.map((call) => call.url)).toEqual(baseline.calls.map((call) => call.url));
    expect(calls.map(headersOf)).toEqual(baseline.calls.map(headersOf));
    for (const call of calls) {
      const names = Object.keys(headersOf(call));
      expect(names).not.toContain('authorization');
      expect(names).not.toContain('x-extra');
      expect(JSON.stringify(headersOf(call))).not.toContain('otra-');
      expect(call.init.method).toBe('POST');
    }
  });

  it('el 400 simulado de la red es un fallo del turno, no un proveedor sin configurar', async () => {
    const network = recordingNetwork();
    const { results } = await twoTurns(createPrincipalClient(KEY, network.send), network);
    expect(results).toEqual([
      { kind: 'failed', costUsd: 0 },
      { kind: 'failed', costUsd: 0 },
    ]);
  });
});

describe('puerta de salida', () => {
  const init = (overrides: RequestInit = {}): RequestInit => ({ method: 'POST', headers: { 'anthropic-beta': ADAPTER_BETA }, body: '{}', ...overrides });

  it.each([
    ['otro origen', 'https://evil.example/v1/messages'],
    ['http en vez de https', 'http://api.anthropic.com/v1/messages'],
    ['otro puerto', 'https://api.anthropic.com:8443/v1/messages'],
    ['otra ruta', 'https://api.anthropic.com/v1/complete'],
    ['ruta con barra final', 'https://api.anthropic.com/v1/messages/'],
    ['ruta más larga', 'https://api.anthropic.com/v1/messages/count_tokens'],
    ['otra consulta', 'https://api.anthropic.com/v1/messages?beta=false'],
    ['consulta extra', 'https://api.anthropic.com/v1/messages?beta=true&x=1'],
    ['consulta distinta', 'https://api.anthropic.com/v1/messages?x=1'],
    ['usuario y contraseña en la URL', 'https://user:pw@api.anthropic.com/v1/messages'],
    ['fragmento', 'https://api.anthropic.com/v1/messages#x'],
    ['subdominio que empieza igual', 'https://api.anthropic.com.evil.example/v1/messages'],
    ['URL no válida', 'no es una url'],
  ])('lanza sin llamar a send con %s', async (_name, url) => {
    const network = recordingNetwork();
    await expect(createAnthropicEgress(KEY, network.send)(url, init())).rejects.toThrow('petición a Claude no permitida');
    expect(network.calls).toEqual([]);
  });

  it.each(['GET', 'PUT', 'DELETE', 'post', undefined])('lanza sin llamar a send con el método %s', async (method) => {
    const network = recordingNetwork();
    await expect(createAnthropicEgress(KEY, network.send)('https://api.anthropic.com/v1/messages', init({ method }))).rejects.toThrow();
    expect(network.calls).toEqual([]);
  });

  it('lanza sin llamar a send con un Request o sin init', async () => {
    const network = recordingNetwork();
    const gate = createAnthropicEgress(KEY, network.send);
    await expect(gate(new Request('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' }), init())).rejects.toThrow();
    await expect(gate('https://api.anthropic.com/v1/messages')).rejects.toThrow();
    expect(network.calls).toEqual([]);
  });

  it('el mensaje del rechazo no lleva la URL, la clave ni cabeceras', async () => {
    const gate = createAnthropicEgress(KEY, recordingNetwork().send);
    const error: unknown = await gate('https://evil.example/secreto?token=abc', init()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('petición a Claude no permitida');
  });

  it('acepta una URL de tipo URL y la reconstruye desde las constantes', async () => {
    const network = recordingNetwork();
    await createAnthropicEgress(KEY, network.send)(new URL('https://API.anthropic.com:443/v1/messages?beta=true'), init());
    expect(network.calls[0]?.url).toBe(`${ANTHROPIC_API_URL}/v1/messages?beta=true`);
  });

  it.each([
    ['objeto', { 'Anthropic-Beta': ADAPTER_BETA, Authorization: 'Bearer x', 'X-Extra': '1' }],
    [
      'array de pares',
      [
        ['ANTHROPIC-BETA', ADAPTER_BETA],
        ['authorization', 'Bearer x'],
      ],
    ],
    ['instancia de Headers', new Headers({ 'Anthropic-Beta': ADAPTER_BETA, 'x-api-key': 'otra-clave' })],
  ] as const)('lee anthropic-beta de un %s sin distinguir mayúsculas y no copia nada más', async (_name, headers) => {
    const network = recordingNetwork();
    await createAnthropicEgress(KEY, network.send)('https://api.anthropic.com/v1/messages?beta=true', init({ headers: headers as HeadersInit }));
    expect(headersOf(network.calls[0])).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      'x-api-key': KEY,
      'anthropic-beta': ADAPTER_BETA,
    });
  });

  it('descarta anthropic-beta en la llamada sin ?beta=true y no inventa uno si falta', async () => {
    const network = recordingNetwork();
    const gate = createAnthropicEgress(KEY, network.send);
    await gate('https://api.anthropic.com/v1/messages', init());
    await gate('https://api.anthropic.com/v1/messages?beta=true', init({ headers: {} }));
    expect(Object.keys(headersOf(network.calls[0]))).not.toContain('anthropic-beta');
    expect(Object.keys(headersOf(network.calls[1]))).not.toContain('anthropic-beta');
  });

  it('pasa method, body y signal, y descarta el resto de init', async () => {
    const network = recordingNetwork();
    const controller = new AbortController();
    await createAnthropicEgress(KEY, network.send)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{"a":1}',
      signal: controller.signal,
      headers: {},
      cache: 'no-store',
      referrer: 'https://evil.example',
    });
    expect(Object.keys(network.calls[0]!.init).sort()).toEqual(['body', 'headers', 'method', 'signal']);
    expect(network.calls[0]!.init.body).toBe('{"a":1}');
    expect(network.calls[0]!.init.signal).toBe(controller.signal);
  });

  it('paridad: el SDK sin variables entrega anthropic-version igual a ANTHROPIC_API_VERSION', async () => {
    const seen: string[] = [];
    const network = recordingNetwork();
    const spy: Send = async (url, requestInit) => {
      seen.push(new Headers(requestInit?.headers).get('anthropic-version') ?? '');
      return network.send(url, requestInit);
    };
    const client = createAnthropicClient({ apiKey: KEY, authToken: null, baseURL: ANTHROPIC_API_URL, fetch: spy });
    await createAnthropicProvider({ client, maxRetries: 0 })(turnRequest(null));
    expect(seen).toEqual([ANTHROPIC_API_VERSION]);
  });

  it('camino completo: una petición a otra dirección no sale y el turno es failed', async () => {
    const network = recordingNetwork();
    const client = createAnthropicClient({ apiKey: KEY, authToken: null, baseURL: 'http://127.0.0.1:9', fetch: createAnthropicEgress(KEY, network.send) });
    const result = await createAnthropicProvider({ client, maxRetries: 0 })(turnRequest(null));
    expect(result).toEqual({ kind: 'failed', costUsd: 0 });
    expect(network.calls).toEqual([]);
  });
});

describe('createLlmProviders', () => {
  it('sin clave, el mapa de proveedores está vacío', () => {
    expect(createLlmProviders({ anthropicApiKey: null }).size).toBe(0);
  });

  it('con clave, solo hay principal', () => {
    const providers = createLlmProviders({ anthropicApiKey: KEY });
    expect([...providers.keys()]).toEqual(['principal']);
    expect(typeof providers.get('principal')).toBe('function');
  });
});
