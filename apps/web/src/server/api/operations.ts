import { API_OPERATIONS } from '@/config/endpoints';
import { ADVANCE_TIMEOUT_MS, READ_TIMEOUT_MS } from '@/config/limits';
import type { ConversationId, FlowId } from '@/server/ids';
import { sendToApi, type TransportResult } from '@/server/api/transport';

// Única puerta hacia la API (D3): exactamente ocho funciones, con rutas y consultas fijas y argumentos ya validados en
// `src/server/ids.ts`. El navegador no elige `limit` ni `published`. `transport.ts` solo lo importa este fichero.

/** `GET /flows?published=true&limit=20&offset=N`. */
export function listPublishedFlows(offset: number): Promise<TransportResult> {
  return sendToApi({ method: 'GET', path: API_OPERATIONS.listPublishedFlows(offset), timeoutMs: READ_TIMEOUT_MS });
}

/** `GET /flows/:flowId/versions/:version`. */
export function getFlowVersion(flowId: FlowId, version: number): Promise<TransportResult> {
  return sendToApi({ method: 'GET', path: API_OPERATIONS.getFlowVersion(flowId, version), timeoutMs: READ_TIMEOUT_MS });
}

/** `GET /conversations?limit=20&offset=N`. */
export function listConversations(offset: number): Promise<TransportResult> {
  return sendToApi({ method: 'GET', path: API_OPERATIONS.listConversations(offset), timeoutMs: READ_TIMEOUT_MS });
}

/** `GET /conversations/:conversationId`. */
export function getConversation(conversationId: ConversationId): Promise<TransportResult> {
  return sendToApi({ method: 'GET', path: API_OPERATIONS.getConversation(conversationId), timeoutMs: READ_TIMEOUT_MS });
}

/** `GET /conversations/:conversationId/transcript?limit=100&offset=N`. */
export function getTranscriptPage(conversationId: ConversationId, offset: number): Promise<TransportResult> {
  return sendToApi({ method: 'GET', path: API_OPERATIONS.getTranscriptPage(conversationId, offset), timeoutMs: READ_TIMEOUT_MS });
}

/** `POST /conversations` con un cuerpo reconstruido (`{"flowId"}` o `{"flowId","contactId"}`). */
export function createConversation(body: string): Promise<TransportResult> {
  return sendToApi({ method: 'POST', path: API_OPERATIONS.createConversation(), body, timeoutMs: ADVANCE_TIMEOUT_MS });
}

/** `POST /conversations/:conversationId/inputs` con `If-Match` y un cuerpo reconstruido (`{"input":…}`). */
export function sendConversationInput(conversationId: ConversationId, body: string, ifMatch: string): Promise<TransportResult> {
  return sendToApi({ method: 'POST', path: API_OPERATIONS.sendConversationInput(conversationId), body, ifMatch, timeoutMs: ADVANCE_TIMEOUT_MS });
}

/** `DELETE /conversations/:conversationId`. */
export function deleteConversation(conversationId: ConversationId): Promise<TransportResult> {
  return sendToApi({ method: 'DELETE', path: API_OPERATIONS.deleteConversation(conversationId), timeoutMs: READ_TIMEOUT_MS });
}
