import { HttpException } from '@nestjs/common';

/** Errores del contrato de la API: el cliente decide por `error`, nunca por `message`. Lista cerrada. */
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
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Estado HTTP y mensaje (en español, para personas) de cada código. */
const DEFINITIONS: Record<ApiErrorCode, { status: number; message: string }> = {
  invalid_json: { status: 400, message: 'el cuerpo no es JSON válido' },
  invalid_flow: { status: 400, message: 'el flujo no es válido' },
  literal_credential: {
    status: 400,
    message: 'una cabecera de credenciales lleva el valor escrito en el flujo: usa una referencia a un secreto',
  },
  flow_id_mismatch: { status: 400, message: 'el id del flujo no coincide con el de la ruta' },
  invalid_query: { status: 400, message: 'parámetros de consulta no válidos' },
  forbidden_host: { status: 403, message: 'host no permitido: la API solo atiende peticiones locales' },
  forbidden_origin: { status: 403, message: 'las peticiones desde navegadores no están permitidas' },
  not_found: { status: 404, message: 'ruta no encontrada' },
  flow_not_found: { status: 404, message: 'flujo no encontrado' },
  version_not_found: { status: 404, message: 'versión no encontrada' },
  flow_already_exists: { status: 409, message: 'ya existe un flujo con ese id' },
  flow_id_reserved: { status: 409, message: 'ese id perteneció a un flujo borrado y no se puede reutilizar' },
  revision_mismatch: { status: 412, message: 'el borrador ha cambiado' },
  payload_too_large: { status: 413, message: 'el cuerpo supera el tamaño máximo de 1 MiB' },
  unsupported_media_type: { status: 415, message: 'el cuerpo debe ser application/json en UTF-8 y sin comprimir' },
  precondition_required: { status: 428, message: 'falta la cabecera If-Match con la revisión del borrador' },
  internal_error: { status: 500, message: 'error interno' },
  database_unavailable: { status: 503, message: 'la base de datos no está disponible' },
};

/**
 * Error del contrato de la API. El cuerpo de la respuesta es exactamente `{message, error, ...extra}`.
 */
export class ApiException extends HttpException {
  /**
   * @param code Código estable del contrato (`error` en la respuesta).
   * @param extra Campos propios del código (`issues`, `warnings`, `currentRevision`…).
   * @param headers Cabeceras de la respuesta (el `ETag` actual en un 412).
   */
  constructor(
    readonly code: ApiErrorCode,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    const { status, message } = DEFINITIONS[code];
    super({ message, error: code, ...extra }, status);
  }
}

/** Estado y mensaje de un código del contrato. */
export function describeApiError(code: ApiErrorCode): { status: number; message: string } {
  return DEFINITIONS[code];
}
