/** Versión del formato de `SessionState`. */
export const STATE_VERSION = 1;
/** Nodos que ejecuta como máximo una operación de avance. */
export const MAX_STEPS_PER_ADVANCE = 200;
/** Retardo de escritura de un `message` cuando el flujo no define `settings.typingDelayMs`. */
export const DEFAULT_TYPING_DELAY_MS = 600;
/** Tamaño máximo (átomos y aserciones tras expandir) de un patrón de `matches`. */
export const MAX_PATTERN_SIZE = 1000;
/** Longitud máxima, en unidades de código UTF-16, de un texto renderizado. */
export const MAX_RENDERED_LENGTH = 16384;

/** Longitud máxima, en unidades de código UTF-16, de la respuesta de texto de un usuario (y de su valor guardado). */
export const MAX_INPUT_LENGTH = 4096;

/** Llamadas externas al host por operación (`http` hoy, `llm` después), reintentos incluidos. */
export const MAX_EXTERNAL_CALLS_PER_ADVANCE = 10;
/** Longitud máxima, en unidades de código UTF-16, de la URL de una petición, antes y después de serializarla. */
export const MAX_URL_LENGTH = 8192;
/** Longitud máxima, en unidades de código UTF-16, del body serializado de una petición. */
export const MAX_REQUEST_BODY_LENGTH = 65536;
/** Longitud máxima, en unidades de código UTF-16, del cuerpo de una respuesta (el host corta a 1 MiB en bytes). */
export const MAX_RESPONSE_BODY_LENGTH = 1048576;

// Internas: no se exportan desde index.ts.
/** Cabeceras que puede declarar un nodo `http`. */
export const MAX_HTTP_HEADERS = 32;
/** Niveles máximos de un valor que `responseMap` guarda en una variable. */
export const MAX_MAPPED_VALUE_DEPTH = 100;
/** Paridad con `schema.$defs.httpNode.properties.timeoutMs.default`. */
export const DEFAULT_HTTP_TIMEOUT_MS = 10000;
/** Paridad con `schema.$defs.httpNode.properties.retries.default`. */
export const DEFAULT_HTTP_RETRIES = 1;

/** Niveles máximos de array/objeto anidados en un flujo, un contacto o un estado recibidos. */
export const MAX_NESTING_DEPTH = 1000;
/** Grupos anidados máximos en un patrón de `matches`. */
export const MAX_PATTERN_DEPTH = 100;

/** Errores que dejan la sesión en `failed`. */
export const SESSION_ERROR_CODES = [
  'unsupported_node',
  'invalid_rule',
  'step_limit_exceeded',
  'value_too_large',
  'invalid_validation',
  'retries_exhausted',
  'invalid_http_config',
  'missing_secret',
  'http_host_error',
  'http_limit_exceeded',
] as const;
export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

/** Rechazos de una operación: no producen eventos ni estado. */
export const REJECTION_CODES = [
  'invalid_flow',
  'invalid_contact',
  'invalid_state',
  'state_mismatch',
  'session_not_active',
  'invalid_input',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

/** Por qué una respuesta es inválida, en el orden en que se comprueba. */
export const INVALID_ANSWER_REASONS = [
  'too_long',
  'required',
  'invalid_format',
  'out_of_range',
  'pattern_mismatch',
] as const;
export type InvalidAnswerReason = (typeof INVALID_ANSWER_REASONS)[number];

/** Por qué termina mal una llamada `http` (campo `error` del evento `http`). */
export const HTTP_ERROR_REASONS = [
  'invalid_url',
  'invalid_header_value',
  'body_too_large',
  'http_status',
  'timeout',
  'network_error',
  'blocked',
  'response_too_large',
  'invalid_response',
] as const;
export type HttpErrorReason = (typeof HTTP_ERROR_REASONS)[number];
