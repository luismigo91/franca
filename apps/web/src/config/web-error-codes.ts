/** Códigos que genera el servidor de la web (no existen en la API; un test comprueba que son disjuntos). */
export const WEB_ERROR_CODES = ['api_unreachable', 'invalid_api_response'] as const;

export type WebErrorCode = (typeof WEB_ERROR_CODES)[number];

/** Indica si un texto es uno de los códigos propios de la web. */
export function isWebErrorCode(value: unknown): value is WebErrorCode {
  return typeof value === 'string' && (WEB_ERROR_CODES as readonly string[]).includes(value);
}
