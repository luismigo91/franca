/**
 * Espejo de `API_ERROR_CODES` de `apps/api/src/http/api-error.ts` (mismo orden). Una app no depende de otra: la paridad
 * la vigila `tests/api-error-codes-parity.test.ts`, que lee el texto de la API.
 */
export const API_ERROR_CODES = [
  'invalid_json',
  'invalid_flow',
  'literal_credential',
  'flow_id_mismatch',
  'invalid_query',
  'forbidden_host',
  'forbidden_origin',
  'not_found',
  'flow_not_found',
  'version_not_found',
  'flow_already_exists',
  'flow_id_reserved',
  'revision_mismatch',
  'payload_too_large',
  'unsupported_media_type',
  'precondition_required',
  'internal_error',
  'database_unavailable',
  'invalid_request',
  'invalid_input',
  'conversation_not_found',
  'flow_not_published',
  'flow_version_invalid',
  'conversation_busy',
  'conversation_not_active',
  'conversation_expired',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Indica si un texto es uno de los códigos de la API. */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}
