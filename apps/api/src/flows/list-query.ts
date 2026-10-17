import { ApiException } from '../http/api-error.js';

export interface ListQuery {
  /** Elementos por página, de 1 a 100. */
  limit: number;
  /** Elementos que se saltan, de 0 a 2147483647. */
  offset: number;
  /** `true`: solo con alguna versión; `false`: sin ninguna; ausente: sin filtro. */
  published?: boolean;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_OFFSET = 2_147_483_647;

/** Un entero decimal sin signo ni espacios (los ceros a la izquierda valen). */
function parseInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'string' || !/^[0-9]{1,10}$/.test(value)) throw new ApiException('invalid_query');
  const number = Number(value);
  if (number < min || number > max) throw new ApiException('invalid_query');
  return number;
}

/**
 * Valida los parámetros de consulta de un listado (`limit`, `offset`, `published`). Los desconocidos se ignoran; uno
 * repetido (el parser de consultas de Express lo entrega como array) o mal formado es `invalid_query`. Es un parser
 * puro y no un `ValidationPipe`: ver `.claude/rules/backend/routes-and-errors.md`.
 *
 * @param query Los parámetros de consulta de la petición (`req.query`).
 * @returns Los valores validados, con los de por defecto.
 * @throws {ApiException} `invalid_query` si alguno no es válido.
 */
export function parseListQuery(query: Record<string, unknown>): ListQuery {
  const limit = query.limit === undefined ? DEFAULT_LIMIT : parseInteger(query.limit, 1, MAX_LIMIT);
  const offset = query.offset === undefined ? 0 : parseInteger(query.offset, 0, MAX_OFFSET);
  const published = query.published;
  if (published === undefined) return { limit, offset };
  if (published !== 'true' && published !== 'false') throw new ApiException('invalid_query');
  return { limit, offset, published: published === 'true' };
}
