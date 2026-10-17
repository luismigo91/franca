import { schema } from '@franca/spec';
import { ApiException } from '../http/api-error.js';

/** El patrón de `id` de la spec, no copiado: `^[a-z][a-z0-9_-]{0,63}$`. */
const FLOW_ID = new RegExp(schema.$defs.id.pattern);
const VERSION = /^[1-9][0-9]*$/;
/** Mayor `int4` de Postgres: un número mayor nunca llega a la base. */
export const MAX_VERSION = 2_147_483_647;

/**
 * Valida el `:flowId` de una ruta con el patrón de `id` de `@franca/spec`.
 *
 * @param value Segmento de la ruta, ya decodificado.
 * @returns El mismo `id`.
 * @throws {ApiException} `flow_not_found` si no cumple el patrón: ningún flujo puede tener ese `id`.
 */
export function parseFlowId(value: string): string {
  if (!FLOW_ID.test(value)) throw new ApiException('flow_not_found');
  return value;
}

/**
 * Interpreta el `:version` de una ruta: un entero positivo en decimal, sin ceros a la izquierda, de como mucho 2147483647.
 *
 * @param value Segmento de la ruta.
 * @returns El número, o `undefined` si no es un número de versión posible (el llamador responde `version_not_found`).
 */
export function parseVersion(value: string): number | undefined {
  if (!VERSION.test(value)) return undefined;
  const version = Number(value);
  return version <= MAX_VERSION ? version : undefined;
}
