import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { continueSession, startSession, type AdvanceResult, type EngineHost, type SessionResult } from '../../src/index.js';
import { replyOk, waiting } from './conversation.js';
import { end, flowOf, httpNode, variable, type Obj } from './flows.js';

/**
 * `h` (http) con `next` a `ok` y `onError` a `ko`, cada uno un `end` con ese `outcome`. `before`
 * son nodos previos (el primero es el `start`); `variables` se declaran tal cual.
 */
export function httpFlow(
  request: Obj = {},
  extra: Obj = {},
  options: { variables?: Obj[]; before?: Obj[]; settings?: Obj } = {},
): Obj {
  return flowOf(
    [...(options.before ?? []), httpNode('h', request, { next: 'ok', onError: 'ko', ...extra }), end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })],
    { variables: options.variables ?? [variable('v')], settings: options.settings },
  );
}

/** Variable con `default`, para fijar un valor desde el arranque. */
export const withValue = (name: string, value: unknown, extra: Obj = {}): Obj => variable(name, { default: value, ...extra });

/** Arranca con el host y exige que la operación se acepte. */
export async function runOk(flow: unknown, host?: EngineHost | null, contact?: unknown): Promise<SessionResult> {
  const result = await startSession({ flow, contact }, host);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as SessionResult;
}

export const httpEvents = (result: SessionResult) => result.events.filter((e) => e.type === 'http');
export const lastEvent = (result: SessionResult) => result.events.at(-1);

/** Afirma que la sesión falló con ese código en el nodo `h` y devuelve el resultado. */
export function expectFailure(result: SessionResult, code: string, nodeId = 'h'): void {
  expect(result.status).toBe('failed');
  expect(result.state.error).toEqual({ code, nodeId });
  expect(result.events.at(-1)).toMatchObject({ type: 'error', code, nodeId });
}

/** El `outcome` con que terminó la sesión (`ok`/`ko` en `httpFlow`). */
export const outcomeOf = (result: SessionResult): string | null => result.state.outcome;

const leads = (): Obj => JSON.parse(readFileSync(new URL('../../../spec/examples/captacion-leads.json', import.meta.url), 'utf8')) as Obj;
const faq = (): Obj => JSON.parse(readFileSync(new URL('../../../spec/examples/faq-ia.json', import.meta.url), 'utf8')) as Obj;
export { faq, leads };

/** `captacion-leads` esperando en `pedir-tamano` con `nombre` Ana y `email` ana@example.com. */
export async function leadsAtSize(): Promise<{ flow: Obj; state: SessionResult['state'] }> {
  const flow = leads();
  const { state } = await waiting(flow);
  const name = await replyOk(flow, state, { text: 'Ana' });
  const mail = await replyOk(flow, name.state, { text: 'ana@example.com' });
  expect(mail.state.nodeId).toBe('pedir-tamano');
  return { flow, state: mail.state };
}

export async function continueWith(flow: unknown, state: unknown, input: unknown, host?: EngineHost | null): Promise<AdvanceResult> {
  return continueSession({ flow, state, input }, host);
}
