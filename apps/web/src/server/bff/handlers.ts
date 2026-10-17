import * as operations from '@/server/api/operations';
import { buildCreateBody, buildInputBody, readIfMatch, readJsonBody, readOffset } from '@/server/bff/request';
import { emptyResponse, errorResponse, failureResponse, toWebResponse, type ResponseKind } from '@/server/bff/responses';
import { isConversationId, isFlowId, parseVersion, type ConversationId } from '@/server/ids';
import { ApiUrlError } from '@/server/config/api-url.mjs';
import { checkFrontier } from '@/server/frontier';
import { logInvalidApiUrl, logServerError } from '@/server/log';
import type { TransportResult } from '@/server/api/transport';

// Los manejadores de las rutas de la web (D3, D8). No importan Next: se prueban sin servidor (D19).

const TEMPLATES = {
  flows: '/api/flows',
  flowVersion: '/api/flows/[flowId]/versions/[version]',
  conversations: '/api/conversations',
  conversation: '/api/conversations/[conversationId]',
  transcript: '/api/conversations/[conversationId]/transcript',
  inputs: '/api/conversations/[conversationId]/inputs',
  other: '/api/[...rest]',
} as const;

type Template = (typeof TEMPLATES)[keyof typeof TEMPLATES];

/** Registra los 5xx (solo plantilla, estado y código) y los devuelve tal cual. */
async function respond(method: string, template: Template, kind: ResponseKind, call: () => Promise<TransportResult>): Promise<Response> {
  let response: Response;
  try {
    response = toWebResponse(await call(), kind);
  } catch (error) {
    // La excepción esperada es `FRANCA_API_URL` inválida en ejecución (si alguien arrancó `next` sin el lanzador).
    if (error instanceof ApiUrlError) logInvalidApiUrl();
    logServerError(method, template, 500, 'internal_error', error instanceof Error ? error.name : 'unknown');
    return errorResponse(500, 'internal_error');
  }
  if (response.status >= 500) {
    const body = (await response.clone().json().catch(() => null)) as { error?: unknown } | null;
    logServerError(method, template, response.status, typeof body?.error === 'string' ? body.error : 'no_body');
  }
  return response;
}

/**
 * Defensa en profundidad del CSRF (D2): las operaciones que cambian algo vuelven a pasar por la misma función pura que
 * `proxy.ts` (`Host` local y `Origin` propio), por si la frontera dejara de ejecutarse delante de la ruta.
 */
function rejectedByFrontier(request: Request): Response | null {
  const decision = checkFrontier({ method: request.method, headers: request.headers, pathname: new URL(request.url).pathname });
  if (decision.allowed) return null;
  return decision.body === null ? emptyResponse(decision.status) : errorResponse(decision.status, 'conversation_not_found');
}

const notFoundConversation = () => errorResponse(404, 'conversation_not_found');

/** `GET /api/flows?offset=N`. */
export async function handleListFlows(request: Request): Promise<Response> {
  const offset = readOffset(request);
  if (!offset.ok) return failureResponse(offset);
  return respond('GET', TEMPLATES.flows, 'json', () => operations.listPublishedFlows(offset.value));
}

/** `GET /api/flows/:flowId/versions/:version`. */
export async function handleFlowVersion(_request: Request, params: { flowId: string; version: string }): Promise<Response> {
  const version = parseVersion(params.version);
  if (!isFlowId(params.flowId) || version === null) return errorResponse(404, 'flow_not_found');
  const flowId = params.flowId;
  return respond('GET', TEMPLATES.flowVersion, 'flowVersion', () => operations.getFlowVersion(flowId, version));
}

/** `GET /api/conversations?offset=N`. */
export async function handleListConversations(request: Request): Promise<Response> {
  const offset = readOffset(request);
  if (!offset.ok) return failureResponse(offset);
  return respond('GET', TEMPLATES.conversations, 'json', () => operations.listConversations(offset.value));
}

/** `POST /api/conversations`. */
export async function handleCreateConversation(request: Request): Promise<Response> {
  const rejected = rejectedByFrontier(request);
  if (rejected) return rejected;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return failureResponse(parsed);
  const body = buildCreateBody(parsed.value);
  if (!body.ok) return failureResponse(body);
  return respond('POST', TEMPLATES.conversations, 'json', () => operations.createConversation(body.value));
}

function validId(params: { conversationId: string }): ConversationId | null {
  return isConversationId(params.conversationId) ? params.conversationId : null;
}

/** `GET /api/conversations/:id`. */
export async function handleGetConversation(_request: Request, params: { conversationId: string }): Promise<Response> {
  const id = validId(params);
  if (id === null) return notFoundConversation();
  return respond('GET', TEMPLATES.conversation, 'json', () => operations.getConversation(id));
}

/** `GET /api/conversations/:id/transcript?offset=N`. */
export async function handleTranscript(request: Request, params: { conversationId: string }): Promise<Response> {
  const id = validId(params);
  if (id === null) return notFoundConversation();
  const offset = readOffset(request);
  if (!offset.ok) return failureResponse(offset);
  return respond('GET', TEMPLATES.transcript, 'json', () => operations.getTranscriptPage(id, offset.value));
}

/** `POST /api/conversations/:id/inputs` (con `If-Match`). */
export async function handleSendInput(request: Request, params: { conversationId: string }): Promise<Response> {
  const rejected = rejectedByFrontier(request);
  if (rejected) return rejected;
  const id = validId(params);
  if (id === null) return notFoundConversation();
  const ifMatch = readIfMatch(request);
  if (!ifMatch.ok) return failureResponse(ifMatch);
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return failureResponse(parsed);
  const body = buildInputBody(parsed.value);
  if (!body.ok) return failureResponse(body);
  return respond('POST', TEMPLATES.inputs, 'json', () => operations.sendConversationInput(id, body.value, ifMatch.value));
}

/** `DELETE /api/conversations/:id`. */
export async function handleDeleteConversation(request: Request, params: { conversationId: string }): Promise<Response> {
  const rejected = rejectedByFrontier(request);
  if (rejected) return rejected;
  const id = validId(params);
  if (id === null) return notFoundConversation();
  return respond('DELETE', TEMPLATES.conversation, 'delete', () => operations.deleteConversation(id));
}

/** Cualquier otra ruta o método de `/api`: 404 sin llamar a la API. */
export function handleNotFound(): Response {
  return errorResponse(404, 'not_found');
}
