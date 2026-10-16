import type { Node } from '@franca/spec';
import type { SessionErrorCode } from '../constants.js';
import type { EngineEvent, EngineHost } from '../types.js';
import type { VariableStore } from '../variables.js';

/** Qué hace la sesión tras ejecutar un nodo. `wait` detiene la operación a la espera del usuario. */
export type StepOutcome =
  | { kind: 'next'; nodeId: string }
  | { kind: 'end'; outcome: string | null }
  | { kind: 'wait'; attempt: number }
  | { kind: 'fail'; code: SessionErrorCode; message: string };

export interface StepContext {
  /** Copia de trabajo de esta operación. */
  readonly vars: VariableStore;
  readonly typingDelayMs: number;
  readonly host: EngineHost;
  /** Variables personales (`pii`, directas o derivadas por `set`): alimentan `containsPii`. */
  readonly piiVariables: ReadonlySet<string>;
  /**
   * Reserva una llamada externa al host del presupuesto de la operación (`MAX_EXTERNAL_CALLS_PER_ADVANCE`).
   * Es **un solo presupuesto** para `http` y `llm`: no hay contadores por nodo.
   *
   * @returns `false` si el presupuesto está agotado.
   */
  reserveExternalCall(): boolean;
  emit(event: EngineEvent): void;
}

export type NodeOfType<K extends Node['type']> = Extract<Node, { type: K }>;

export type NodeExecutor<K extends Node['type']> = (
  node: NodeOfType<K>,
  ctx: StepContext,
) => StepOutcome | Promise<StepOutcome>;
