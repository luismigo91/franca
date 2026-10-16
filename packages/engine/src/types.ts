import type { FlowIssue } from '@franca/spec';
import type { RejectionCode, SessionErrorCode, STATE_VERSION } from './constants.js';

/** Valor JSON. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Valor de una variable con valor. "Sin valor" se representa por ausencia (o `null` donde se indica). */
export type VariableValue = Exclude<JsonValue, null>;

export type RenderedContentItem =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'video' | 'audio' | 'embed'; url: string; alt?: string };

export interface EngineMessageEvent {
  type: 'message';
  nodeId: string;
  content: RenderedContentItem[];
  typingDelayMs: number;
}

export interface EngineEndEvent {
  type: 'end';
  nodeId: string;
  outcome: string | null;
}

export interface EngineErrorEvent {
  type: 'error';
  nodeId: string;
  code: SessionErrorCode;
  message: string;
}

export type EngineEvent = EngineMessageEvent | EngineEndEvent | EngineErrorEvent;

export type SessionStatus = 'ended' | 'failed';

export interface SessionError {
  code: SessionErrorCode;
  nodeId: string;
}

export interface SessionState {
  stateVersion: typeof STATE_VERSION;
  flowId: string;
  status: SessionStatus;
  /** Nodo en el que se detuvo la sesión: el end, el que falló o el que habría sido el paso 201. */
  nodeId: string;
  /** Variables de sesión con valor (las sin valor no aparecen), en orden de declaración. */
  variables: Record<string, VariableValue>;
  /** Todas las variables de contacto declaradas, `null` si no tienen valor, en orden de declaración. */
  contact: Record<string, VariableValue | null>;
  /** Solo si `status === 'ended'`. */
  outcome: string | null;
  /** Solo si `status === 'failed'`. */
  error: SessionError | null;
}

export interface SessionResult {
  ok: true;
  status: SessionStatus;
  events: EngineEvent[];
  state: SessionState;
}

export type Rejection =
  | { ok: false; code: 'invalid_flow'; message: string; issues: FlowIssue[] }
  | { ok: false; code: Exclude<RejectionCode, 'invalid_flow'>; message: string };

export type AdvanceResult = SessionResult | Rejection;

export interface StartSessionRequest {
  flow: unknown;
  contact?: unknown;
}

export interface ContinueSessionRequest {
  flow: unknown;
  state: unknown;
  input: unknown;
}

/** Capacidades que inyecta el host. Vacía en esta versión. */
export interface EngineHost {}
