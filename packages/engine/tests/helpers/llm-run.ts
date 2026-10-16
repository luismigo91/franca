import { expect } from 'vitest';
import { continueSession, startSession, type EngineEvent, type EngineHost, type SessionResult } from '../../src/index.js';

/** Arranca una sesión y exige que la operación se acepte. */
export async function begin(flow: unknown, host?: EngineHost | null, contact?: unknown): Promise<SessionResult> {
  const result = await startSession({ flow, contact }, host);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as SessionResult;
}

/** Continúa desde `state` con la entrada dada (`{text}` si es un string) y exige que se acepte. */
export async function proceed(flow: unknown, state: unknown, input: unknown, host?: EngineHost | null): Promise<SessionResult> {
  const result = await continueSession({ flow, state, input: typeof input === 'string' ? { text: input } : input }, host);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as SessionResult;
}

/** Arranca y continúa con cada mensaje, usando cada vez el estado devuelto. Devuelve todos los resultados. */
export async function chat(flow: unknown, host: EngineHost | null | undefined, messages: readonly unknown[], contact?: unknown): Promise<SessionResult[]> {
  const results = [await begin(flow, host, contact)];
  for (const message of messages) results.push(await proceed(flow, results[results.length - 1]!.state, message, host));
  return results;
}

export const eventsOfType = <T extends EngineEvent['type']>(result: SessionResult, type: T): Extract<EngineEvent, { type: T }>[] =>
  result.events.filter((event): event is Extract<EngineEvent, { type: T }> => event.type === type);

/** Los eventos `llm` de un resultado. */
export const llmEvents = (result: SessionResult) => eventsOfType(result, 'llm');

/** Afirma que la sesión falló con `code` en el nodo `nodeId`, que el error es el último evento y que el estado lo recoge. */
export function expectFailed(result: SessionResult, code: string, nodeId: string): void {
  expect(result.status).toBe('failed');
  const last = result.events[result.events.length - 1];
  expect(last).toMatchObject({ type: 'error', code, nodeId });
  expect(result.state.error).toEqual({ code, nodeId });
  expect(result.state.conversation).toBeUndefined();
}

/** Afirma que la sesión terminó con ese `outcome`. */
export function expectEnded(result: SessionResult, outcome: string): void {
  expect(result.status).toBe('ended');
  expect(result.events[result.events.length - 1]).toMatchObject({ type: 'end', outcome });
}

/** El evento `input` de una espera en un llm. */
export const waitingInput = (nodeId = 'a', attempt = 1, reason: string | null = null) => ({ type: 'input', nodeId, inputType: 'text', attempt, reason });

/** El evento `message` del texto del asistente. */
export const assistantMessage = (text: string, nodeId = 'a', typingDelayMs = 600) => ({
  type: 'message',
  nodeId,
  content: [{ kind: 'text', text }],
  typingDelayMs,
});

/** El evento `llm` con su forma exacta. */
export const llmEvent = (turns: number, costUsd: number, reason: string | null, nodeId = 'a') => ({ type: 'llm', nodeId, turns, costUsd, reason });
