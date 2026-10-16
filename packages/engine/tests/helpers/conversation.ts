import { expect } from 'vitest';
import { continueSession, startSession, type AdvanceResult, type EngineHost, type SessionResult } from '../../src/index.js';
import { end, flowOf, input, variable, type Obj } from './flows.js';

/**
 * Arranca una sesión y continúa con cada entrada de `steps`. Cada paso parte del último estado
 * **aceptado** (un rechazo no avanza la conversación). Devuelve todos los resultados, incluidos los rechazos.
 */
export async function converse(flow: unknown, steps: readonly unknown[], contact?: unknown, host?: EngineHost | null): Promise<AdvanceResult[]> {
  const results: AdvanceResult[] = [await startSession({ flow, contact }, host)];
  let last: SessionResult | undefined = results[0]!.ok ? (results[0] as SessionResult) : undefined;
  for (const input of steps) {
    if (!last) throw new Error('la conversación no puede continuar: el paso anterior no dejó un estado');
    const result = await continueSession({ flow, state: last.state, input }, host);
    results.push(result);
    if (result.ok) last = result;
  }
  return results;
}

/** El resultado `i` de una conversación, exigiendo que se aceptara. */
export function accepted(results: readonly AdvanceResult[], i: number): SessionResult {
  const result = results[i]!;
  if (!result.ok) throw new Error(`el paso ${i} se rechazó: ${result.code}`);
  return result;
}

// ---- helpers para los escenarios de `input`

/** Flujo `input` (variable `v`) → `end`. `variableExtra` cambia la declaración de `v`; `flowExtra`, el flujo. */
export function simpleFlow(
  inputType: string,
  extra: Obj = {},
  options: { variableExtra?: Obj; flowExtra?: Obj; settings?: Obj; more?: Obj[]; id?: string } = {},
): Obj {
  return flowOf([input('p', 'v', inputType, 'fin', extra), end('fin', { outcome: 'listo' }), ...(options.more ?? [])], {
    variables: [variable('v', options.variableExtra)],
    settings: options.settings,
    extra: options.flowExtra,
    id: options.id,
  });
}

/** Arranca y exige que la sesión espere. */
export async function waiting(flow: unknown, contact?: unknown): Promise<{ flow: unknown; state: SessionResult['state'] }> {
  const result = await startSession({ flow, contact });
  expect(result.ok && result.status, JSON.stringify(result)).toBe('waiting');
  return { flow, state: (result as SessionResult).state };
}

/** Continúa desde `state`; el estado recibido no se modifica. */
export async function reply(flow: unknown, state: unknown, input: unknown): Promise<AdvanceResult> {
  return continueSession({ flow, state, input });
}

/** Resultado aceptado de continuar; falla el test si se rechazó. */
export async function replyOk(flow: unknown, state: unknown, input: unknown): Promise<SessionResult> {
  const result = await reply(flow, state, input);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as SessionResult;
}

/** Envía `{text}` a un input de `inputType` y devuelve el resultado. */
export async function answerText(
  inputType: string,
  text: string,
  extra: Obj = {},
  options: Parameters<typeof simpleFlow>[2] = {},
): Promise<SessionResult> {
  const flow = simpleFlow(inputType, extra, options);
  const { state } = await waiting(flow);
  return replyOk(flow, state, { text });
}

/** El `reason` del evento `input` de un resultado que reintenta, o `undefined` si la respuesta se aceptó. */
export function reasonOf(result: SessionResult): string | null | undefined {
  const event = result.events.find((e) => e.type === 'input');
  return event?.type === 'input' ? event.reason : undefined;
}

/** Afirma que la respuesta fue válida y devuelve el valor guardado en `v`. */
export function savedValue(result: SessionResult, scope: 'variables' | 'contact' = 'variables'): unknown {
  expect(result.status, JSON.stringify(result.events)).not.toBe('waiting');
  return result.state[scope].v;
}

/** Afirma que la respuesta fue inválida con ese `reason` (y la sesión sigue esperando). */
export function expectInvalid(result: SessionResult, reason: string): void {
  expect(result.status).toBe('waiting');
  expect(reasonOf(result)).toBe(reason);
}
