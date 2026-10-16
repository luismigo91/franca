import type { FlowIssue, HttpNode, InputNode } from '@franca/spec';
import type { HttpErrorReason, InvalidAnswerReason, RejectionCode, SessionErrorCode, STATE_VERSION } from './constants.js';

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

/** Tipo de respuesta que pide un `input`; derivado de `@franca/spec`. */
export type InputType = InputNode['inputType'];

/** Entrada del usuario que acepta `continueSession`. El motor la comprueba siempre: llega como `unknown`. */
export type UserInput = { text: string } | { choice: string } | { choices: string[] };

export interface EngineChoice {
  id: string;
  label: string;
  imageUrl?: string;
}

interface EngineInputEventBase {
  type: 'input';
  nodeId: string;
  /** Número de intento: 1 la primera vez que se pregunta. */
  attempt: number;
  /** Motivo del rechazo de la respuesta anterior, o `null` si no lo hubo. */
  reason: InvalidAnswerReason | null;
  /** Solo si el flujo lo define; renderizado. */
  placeholder?: string;
}

export interface EngineTextInputEvent extends EngineInputEventBase {
  inputType: Exclude<InputType, 'choice'>;
}

export interface EngineChoiceInputEvent extends EngineInputEventBase {
  inputType: 'choice';
  multiple: boolean;
  choices: EngineChoice[];
}

export type EngineInputEvent = EngineTextInputEvent | EngineChoiceInputEvent;

export interface EngineHttpEvent {
  type: 'http';
  nodeId: string;
  /** Llamadas hechas al host (0 si la petición no se pudo construir). */
  attempts: number;
  /** Status del último intento si fue una respuesta; si no, `null`. */
  status: number | null;
  /** `null` en un éxito; si no, el motivo. */
  error: HttpErrorReason | null;
}

export type EngineEvent = EngineMessageEvent | EngineInputEvent | EngineHttpEvent | EngineEndEvent | EngineErrorEvent;

export type SessionStatus = 'ended' | 'failed' | 'waiting';

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
  /** Solo si `status === 'waiting'`: número de intento de la pregunta pendiente (entero ≥ 1). */
  attempt?: number;
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

/** Método de una petición `http`; derivado de `@franca/spec`, nunca redefinido. */
export type HttpMethod = HttpNode['request']['method'];

/** Cabecera de una petición: valor ya renderizado, o secreto por nombre (el motor nunca tiene su valor). */
export type HttpRequestHeader = { name: string; value: string } | { name: string; secret: string };

/** Lo que recibe el host en cada intento. Objeto nuevo por intento; el host puede quedárselo o mutarlo. */
export interface HttpRequest {
  nodeId: string;
  method: HttpMethod;
  /** Serialización WHATWG (`href`) de la URL ya validada. */
  url: string;
  /** Orden del flujo; `Content-Type` por defecto al final. */
  headers: HttpRequestHeader[];
  /** JSON compacto, o `null` sin body. */
  body: string | null;
  /** Del nodo o 10000; el host lo aplica a este intento. */
  timeoutMs: number;
  /** 1 el primero. */
  attempt: number;
  /** Alguna plantilla de `url`, cabeceras o body nombra una variable personal (`pii`, directa o derivada). */
  containsPii: boolean;
}

/** Resultado de **un** intento. Las propiedades adicionales se ignoran. */
export type HttpAttemptResult =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'timeout' }
  | { kind: 'network_error'; requestSent?: boolean }
  | { kind: 'blocked' }
  | { kind: 'response_too_large' }
  | { kind: 'missing_secret' };

/** Capacidad `http` del host: ejecuta un intento. Debe resolver siempre; rechazar es un defecto del host. */
export type HttpCapability = (request: HttpRequest) => Promise<HttpAttemptResult>;

/** Capacidades que inyecta el host. */
export interface EngineHost {
  /** Sin ella, un nodo `http` falla con `unsupported_node`. */
  http?: HttpCapability;
}
