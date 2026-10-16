import type Anthropic from '@anthropic-ai/sdk';
import type { LlmSlotRequest, LlmTurnRequest } from '@franca/engine';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { createAnthropicClient } from '../../src/client.js';

const FIXTURES = new URL('../fixtures/api/', import.meta.url);

/** Un cuerpo de la forma real de la API (ver `tests/fixtures/api/README.md`). */
export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')) as Record<string, unknown>;
}

/** Una llamada que recibió el `fetch` falso. */
export interface RecordedCall {
  url: string;
  method: string;
  /** Nombres en minúsculas. */
  headers: Record<string, string>;
  /** El cuerpo parseado (los tests de privacidad miran su texto con `JSON.stringify`). */
  body: Record<string, any>;
  signal: AbortSignal | null;
}

/** Qué responde el `fetch` falso a una llamada. */
export type ApiStep =
  | { status?: number; body: unknown; headers?: Record<string, string> }
  /** No responde nunca, pero atiende la señal de aborto. */
  | 'hang'
  /** No responde nunca y **ignora** la señal de aborto. */
  | 'hang-ignoring-signal'
  /** Rechaza como un fallo de red. */
  | 'network-error'
  | ((call: RecordedCall, index: number) => ApiStep);

export interface FakeApi {
  fetch: typeof fetch;
  calls: RecordedCall[];
  /** Un cliente del SDK **real** que usa este `fetch` (sin red). */
  client(options?: Record<string, unknown>): Anthropic;
}

const json = (body: unknown, status: number, headers: Record<string, string>): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * Un `fetch` con guion que registra cada llamada (URL, cabeceras, cuerpo parseado y señal) y responde
 * con `new Response(...)`. El último paso se repite. Se usa con el SDK real:
 * `createAnthropicClient({ apiKey: 'clave-de-prueba', fetch })`, nunca con un valor con forma de clave real.
 */
export function fakeApi(steps: readonly ApiStep[]): FakeApi {
  const calls: RecordedCall[] = [];
  const fakeFetch = (async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? request?.headers).forEach((value, key) => void (headers[key] = value));
    const raw = init?.body ?? (request ? await request.text() : undefined);
    const call: RecordedCall = {
      url: String(request?.url ?? input),
      method: init?.method ?? request?.method ?? 'GET',
      headers,
      body: typeof raw === 'string' && raw !== '' ? (JSON.parse(raw) as Record<string, any>) : {},
      signal: init?.signal ?? request?.signal ?? null,
    };
    const index = calls.push(call) - 1;
    let step: ApiStep = steps[Math.min(index, steps.length - 1)]!;
    while (typeof step === 'function') step = step(call, index);
    if (step === 'network-error') throw new TypeError('fetch failed');
    if (step === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        call.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    }
    if (step === 'hang-ignoring-signal') return new Promise<Response>(() => {});
    return json(step.body, step.status ?? 200, step.headers ?? {});
  }) as typeof fetch;
  return {
    fetch: fakeFetch,
    calls,
    client: (options = {}) => createAnthropicClient({ apiKey: 'clave-de-prueba', fetch: fakeFetch, ...options }),
  };
}

/** Una respuesta 200 con la forma de `message-end-turn.json` y los cambios dados. Sin `slots`, los dos de `turnRequest()` vacíos. */
export function okMessage(
  output: { text?: string; done?: boolean; slots?: Record<string, unknown> } = {},
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const message = fixture('message-end-turn');
  message.content = [{ type: 'text', text: JSON.stringify({ text: output.text ?? '¿En qué puedo ayudarte?', done: output.done ?? false, slots: output.slots ?? { s0: null, s1: null } }) }];
  return { ...message, ...overrides };
}

/** Un paso `200` con `okMessage`. */
export const ok = (output?: Parameters<typeof okMessage>[0], overrides?: Record<string, unknown>): ApiStep => ({ body: okMessage(output, overrides) });
/** Un paso con un cuerpo de error de la API. */
export const apiError = (status: 400 | 401 | 403 | 404 | 429 | 500 | 529, headers: Record<string, string> = {}): ApiStep => {
  const names = { 400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 404: 'not_found_error', 429: 'rate_limit_error', 500: 'api_error', 529: 'overloaded_error' } as const;
  return { status, body: fixture(`error-${status}-${names[status]}`), headers };
};
/** Un error transitorio que el SDK reintenta casi sin esperar. */
export const quickRetry = (status: 429 | 500 | 529): ApiStep => apiError(status, { 'retry-after-ms': '1' });

/** Una petición de turno del motor. */
export function turnRequest(overrides: Partial<LlmTurnRequest> = {}): LlmTurnRequest {
  return {
    nodeId: 'asistente',
    provider: 'principal',
    model: null,
    system: 'Respondes solo sobre precios, horarios y envíos del servicio.',
    goal: 'Resolver la duda del usuario.',
    slots: [
      { name: 'resuelto', type: 'boolean', description: 'true si el usuario confirma que su duda está resuelta', required: true, collected: false },
      { name: 'motivo', type: 'string', description: 'Resumen en una frase de lo que necesita', required: false, collected: false },
    ],
    history: [],
    temperature: null,
    locale: 'es',
    turn: 1,
    maxTurns: 10,
    ...overrides,
  };
}

export const slot = (name: string, type: LlmSlotRequest['type'], extra: Partial<LlmSlotRequest> = {}): LlmSlotRequest => ({
  name,
  type,
  description: `Valor de ${name}`,
  required: true,
  collected: false,
  ...extra,
});

/** Espías sobre todos los métodos de `console`. */
export function spyOnConsole() {
  return (Object.keys(console) as (keyof Console)[])
    .filter((key) => typeof console[key] === 'function')
    .map((key) => vi.spyOn(console, key as 'log').mockImplementation(() => {}));
}
