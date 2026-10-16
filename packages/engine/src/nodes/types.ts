import type { Node } from '@franca/spec';
import type { SessionErrorCode } from '../constants.js';
import type { Conversation } from '../llm/conversation.js';
import type { EngineEvent, EngineHost, VariableType } from '../types.js';
import type { VariableStore } from '../variables.js';

/** Qué hace la sesión tras ejecutar un nodo. `wait` detiene la operación a la espera del usuario. */
export type StepOutcome =
  | { kind: 'next'; nodeId: string }
  | { kind: 'end'; outcome: string | null }
  /** `conversation` solo la aporta un `llm`: su presencia en el estado dice «espera en un llm». */
  | { kind: 'wait'; attempt: number; conversation?: Conversation }
  | { kind: 'fail'; code: SessionErrorCode; message: string };

export interface StepContext {
  /** Copia de trabajo de esta operación. */
  readonly vars: VariableStore;
  readonly typingDelayMs: number;
  /** `locale` del flujo, o `"es"`. */
  readonly locale: string;
  /** Tipo declarado de cada variable (la primera declaración manda); se construye una vez por operación. */
  readonly variableTypes: ReadonlyMap<string, VariableType>;
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
