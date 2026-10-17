import { leads } from './examples.js';

type HeaderValue = string | { secret: string };

export interface HttpCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, HeaderValue>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Un flujo `cadena-http` que hace cada llamada en un nodo `h1`, `h2`… y sigue al siguiente tenga éxito o falle, hasta un
 * `end` `fin`. Los eventos `http` de la conversación, en orden, son los resultados de las llamadas.
 */
export function httpChain(calls: readonly HttpCall[], id = 'cadena-http'): any {
  return {
    specVersion: '0.1',
    id,
    name: 'Cadena de llamadas http',
    start: 'h1',
    nodes: [
      ...calls.map((call, index) => ({
        id: `h${index + 1}`,
        type: 'http',
        request: {
          method: call.method,
          url: call.url,
          ...(call.headers ? { headers: call.headers } : {}),
          ...(call.body !== undefined ? { body: call.body } : {}),
        },
        ...(call.timeoutMs !== undefined ? { timeoutMs: call.timeoutMs } : {}),
        ...(call.retries !== undefined ? { retries: call.retries } : {}),
        next: index + 1 < calls.length ? `h${index + 2}` : 'fin',
        onError: index + 1 < calls.length ? `h${index + 2}` : 'fin',
      })),
      { id: 'fin', type: 'end', outcome: 'fin' },
    ],
  };
}

/** El flujo `llm-http` de los escenarios de `conversations-api` y `http-host`, con `timeoutMs` y una cabecera de secreto opcionales. */
export function llmHttp(options: { timeoutMs?: number; secret?: string } = {}): any {
  return {
    specVersion: '0.1',
    id: 'llm-http',
    name: 'llm y http',
    start: 'a',
    nodes: [
      { id: 'a', type: 'llm', provider: 'principal', goal: 'Saluda.', next: 'h', onExhausted: 'h' },
      {
        id: 'h',
        type: 'http',
        request: {
          method: 'GET',
          url: 'https://api.example.com/estado',
          ...(options.secret ? { headers: { Authorization: { secret: options.secret } } } : {}),
        },
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        retries: 0,
        next: 'ok',
        onError: 'ko',
      },
      { id: 'ok', type: 'end', outcome: 'ok' },
      { id: 'ko', type: 'end', outcome: 'ko' },
    ],
  };
}

/** `captacion-leads` con la `url` de `enviar-crm` cambiada y/o cabeceras añadidas. */
export function leadsWith(patch: { url?: string; headers?: Record<string, HeaderValue>; timeoutMs?: number }): any {
  const flow = leads();
  const node = flow.nodes.find((candidate: { id: string }) => candidate.id === 'enviar-crm');
  if (patch.url) node.request.url = patch.url;
  if (patch.headers) node.request.headers = { ...node.request.headers, ...patch.headers };
  if (patch.timeoutMs !== undefined) node.timeoutMs = patch.timeoutMs;
  return flow;
}

/** Los eventos `http` de la respuesta de un avance. */
export const httpEvents = (body: { events: { type: string }[] }): any[] => body.events.filter((event) => event.type === 'http');
