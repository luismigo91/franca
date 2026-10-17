import { schema } from '@franca/spec';
import { ApiException } from '../http/api-error.js';
import { parseListQuery } from '../flows/list-query.js';

/** El patrón de `id` de la spec, no copiado. */
const FLOW_ID = new RegExp(schema.$defs.id.pattern);

export const CONVERSATION_STATUSES = ['waiting', 'ended', 'failed', 'expired'] as const;
export type ConversationStatusFilter = (typeof CONVERSATION_STATUSES)[number];

export interface ConversationListQuery {
  flowId?: string;
  status?: ConversationStatusFilter;
  limit: number;
  offset: number;
}

/**
 * Valida los parámetros de `GET /conversations`: `flowId` (patrón de `id`), `status` y `limit`/`offset` (como el listado
 * de flujos). Uno repetido (un array), mal formado o fuera de rango es `invalid_query`; los desconocidos, `published`
 * incluido, se ignoran.
 *
 * @param query Los parámetros de consulta de la petición (`req.query`).
 * @returns Los valores validados, con los de por defecto de la paginación.
 * @throws {ApiException} `invalid_query` si alguno no es válido.
 */
export function parseConversationListQuery(query: Record<string, unknown>): ConversationListQuery {
  const { limit, offset } = parseListQuery({ limit: query.limit, offset: query.offset });
  const result: ConversationListQuery = { limit, offset };
  if (query.flowId !== undefined) {
    if (typeof query.flowId !== 'string' || !FLOW_ID.test(query.flowId)) throw new ApiException('invalid_query');
    result.flowId = query.flowId;
  }
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !(CONVERSATION_STATUSES as readonly string[]).includes(query.status)) {
      throw new ApiException('invalid_query');
    }
    result.status = query.status as ConversationStatusFilter;
  }
  return result;
}
