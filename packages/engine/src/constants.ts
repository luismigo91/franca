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

/** Errores que dejan la sesión en `failed`. */
export const SESSION_ERROR_CODES = [
  'unsupported_node',
  'invalid_rule',
  'step_limit_exceeded',
  'value_too_large',
] as const;
export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

/** Rechazos de una operación: no producen eventos ni estado. */
export const REJECTION_CODES = [
  'invalid_flow',
  'invalid_contact',
  'invalid_state',
  'state_mismatch',
  'session_not_active',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];
