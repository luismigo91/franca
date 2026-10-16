import type { FlowIssue, HttpNode, InputNode, Variable } from '@franca/spec';
import type { HttpErrorReason, InvalidAnswerReason, LlmExitReason, RejectionCode, SessionErrorCode, STATE_VERSION } from './constants.js';

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

/** Salida de un nodo `llm`: turnos hechos, coste acumulado y motivo (`null` si sale por `next`). Sin textos ni slots. */
export interface EngineLlmEvent {
  type: 'llm';
  nodeId: string;
  turns: number;
  costUsd: number;
  reason: LlmExitReason | null;
}

export type EngineEvent =
  | EngineMessageEvent
  | EngineInputEvent
  | EngineHttpEvent
  | EngineLlmEvent
  | EngineEndEvent
  | EngineErrorEvent;

export type SessionStatus = 'ended' | 'failed' | 'waiting';

export interface SessionError {
  code: SessionErrorCode;
  nodeId: string;
}

/** Tipo de una variable del flujo; derivado de `@franca/spec`, nunca redefinido. */
export type VariableType = Variable['type'];

/** Mensaje de la conversación de un `llm`. */
export interface LlmMessage {
  role: 'assistant' | 'user';
  text: string;
}

/**
 * Conversación de un `llm` en espera. Contiene lo que escribió el usuario: es un dato personal que el
 * host de producción persiste con retención y borrado.
 */
export interface LlmConversation {
  /** Alternan, empiezan y terminan en el asistente; de 1 a 99. */
  messages: LlmMessage[];
  /** Coste acumulado: number finito ≥ 0. */
  costUsd: number;
  /** Slots recogidos y válidos (nunca `null`). */
  collected: Record<string, VariableValue>;
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
  /** Solo si `status === 'waiting'` en un nodo `llm`: su conversación. Su presencia dice «espera en un llm». */
  conversation?: LlmConversation;
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

/** Slot de un turno: una variable del nodo, con su tipo declarado. */
export interface LlmSlotRequest {
  name: string;
  type: VariableType;
  description: string;
  required: boolean;
  /** La conversación ya tiene un valor válido para este slot. */
  collected: boolean;
}

/** Lo que recibe el host en cada turno. Objeto nuevo por turno; el host puede quedárselo o mutarlo. */
export interface LlmTurnRequest {
  nodeId: string;
  provider: string;
  model: string | null;
  /** Renderizado como plantilla. */
  system: string | null;
  /** Renderizado como plantilla. */
  goal: string;
  /** Una por variable distinta de los slots del nodo, en su orden. */
  slots: LlmSlotRequest[];
  /** `[]` en el turno 1; después termina en el mensaje del usuario que motiva el turno. */
  history: LlmMessage[];
  temperature: number | null;
  /** Del flujo o `"es"`. */
  locale: string;
  /** 1 el primero. */
  turn: number;
  /** Del nodo o 8. */
  maxTurns: number;
}

/** Resultado de un turno. Las propiedades adicionales se ignoran. */
export type LlmTurnResult =
  | { kind: 'turn'; text: string; slots: Readonly<Record<string, JsonValue>>; done: boolean; costUsd: number }
  | { kind: 'refusal'; costUsd: number }
  | { kind: 'failed'; costUsd: number }
  | { kind: 'not_configured' };

/** Capacidad `llm` del host: hace **un** turno. Debe resolver siempre; rechazar es un defecto del host. */
export type LlmCapability = (request: LlmTurnRequest) => Promise<LlmTurnResult>;

/** Capacidades que inyecta el host. */
export interface EngineHost {
  /** Sin ella, un nodo `http` falla con `unsupported_node`. */
  http?: HttpCapability;
  /** Sin ella, un nodo `llm` falla con `unsupported_node`. */
  llm?: LlmCapability;
}
