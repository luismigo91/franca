import type { EngineEvent, SessionResult } from '@franca/engine';
import type { Flow } from '@franca/spec';
import type { AdvanceLlm } from './advance-llm.js';
import { diffContact, type ContactView } from './contact-values.js';
import { expiresAtOf } from './conversation-timing.js';
import type { AdvanceWrite } from './conversations.repository.js';

export interface BuildWriteOptions {
  /** El resultado del motor, ya aceptado. */
  result: SessionResult;
  /** La versión que acaba de aceptar el motor (para el plazo de caducidad). */
  flow: Pick<Flow, 'settings'>;
  /** La entrada del usuario tal como llegó; `undefined` en la creación. */
  input: { value: unknown } | undefined;
  /** Coste y bandera de la conversación antes de este avance. */
  prior: { costUsd: number; costLimitReached: boolean };
  /** La capacidad `llm` de este avance (su gasto y si bloqueó algún turno). */
  advance: AdvanceLlm;
  /** Vista de contacto al empezar el avance; `null` en una conversación sin contacto (no guarda nada). */
  contactBefore: ContactView | null;
  /** El instante del paso: `updatedAt`, base de `expiresAt`. */
  now: Date;
}

/** El último evento `input` de un avance: lo que el chat debe pintar para responder. */
function lastInputEvent(events: readonly EngineEvent[]): EngineEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]!.type === 'input') return events[index];
  }
  return undefined;
}

/**
 * Lo que se escribe tras un avance. `waiting` guarda el estado del motor y su `pendingInput`; `ended` y `failed` los
 * descartan (minimización: el estado lleva variables `pii`). La transcripción añade la entrada del usuario tal como llegó y
 * después cada evento tal cual. El coste es el previo más lo gastado en este avance. Solo se guardan los valores de
 * contacto que el avance cambió.
 *
 * @param options Resultado del motor y contexto del avance.
 * @returns Lo que escribe el repositorio, sin `seq` ni fechas de las entradas (los pone bajo el bloqueo).
 */
export function buildAdvanceWrite(options: BuildWriteOptions): AdvanceWrite {
  const { result, now } = options;
  const waiting = result.status === 'waiting';
  const changes = options.contactBefore === null ? null : diffContact(options.contactBefore, result.state.contact);
  const pending = waiting ? lastInputEvent(result.events) : undefined;
  return {
    status: result.status,
    state: waiting ? JSON.stringify(result.state) : null,
    pendingInputJson: pending === undefined ? null : JSON.stringify(pending),
    outcome: result.status === 'ended' ? result.state.outcome : null,
    errorCode: result.status === 'failed' ? (result.state.error?.code ?? null) : null,
    errorNodeId: result.status === 'failed' ? (result.state.error?.nodeId ?? null) : null,
    costUsd: options.prior.costUsd + options.advance.spentUsd(),
    costLimitReached: options.prior.costLimitReached || options.advance.limitReached(),
    expiresAt: waiting ? expiresAtOf(now, options.flow) : null,
    entries: [
      ...(options.input === undefined ? [] : [{ role: 'user' as const, payload: JSON.stringify(options.input.value) }]),
      ...result.events.map((event) => ({ role: 'flow' as const, payload: JSON.stringify(event) })),
    ],
    contactUpserts: changes === null ? [] : changes.upserts.map(([name, value]) => [name, JSON.stringify(value)] as [string, string]),
    contactDeletes: changes === null ? [] : changes.deletes,
  };
}
