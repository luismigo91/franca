import * as operations from '@/server/api/operations';
import { buildCreateBody, buildInputBody, readFlowBody, readIfMatch, readJsonBody, readOffset } from '@/server/bff/request';
import { emptyResponse, errorResponse, failureResponse, jsonResponse, toWebResponse, type ResponseKind } from '@/server/bff/responses';
import { isConversationId, isFlowId, parseVersion, type ConversationId, type FlowId } from '@/server/ids';
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
  editorFlows: '/api/editor/flows',
  editorFlow: '/api/editor/flows/[flowId]',
  editorVersions: '/api/editor/flows/[flowId]/versions',
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
  // El cuerpo de la decisión lo fija la frontera: `conversation_not_found` o `flow_not_found` según la ruta.
  return decision.body === null ? emptyResponse(decision.status) : jsonResponse(decision.status, JSON.parse(decision.body));
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

const notFoundFlow = () => errorResponse(404, 'flow_not_found');

function validFlowId(params: { flowId: string }): FlowId | null {
  return isFlowId(params.flowId) ? params.flowId : null;
}

/** `GET /api/editor/flows?offset=N`: todos los flujos vivos (sin `published`). */
export async function handleListEditorFlows(request: Request): Promise<Response> {
  const offset = readOffset(request);
  if (!offset.ok) return failureResponse(offset);
  return respond('GET', TEMPLATES.editorFlows, 'json', () => operations.listFlows(offset.value));
}

/** `POST /api/editor/flows`. */
export async function handleCreateFlow(request: Request): Promise<Response> {
  const rejected = rejectedByFrontier(request);
  if (rejected) return rejected;
  const body = await readFlowBody(request);
  if (!body.ok) return failureResponse(body);
  return respond('POST', TEMPLATES.editorFlows, 'json', () => operations.createFlow(body.value));
}

/** `GET /api/editor/flows/:flowId`. */
export async function handleGetFlow(_request: Request, params: { flowId: string }): Promise<Response> {
  const id = validFlowId(params);
  if (id === null) return notFoundFlow();
  return respond('GET', TEMPLATES.editorFlow, 'json', () => operations.getFlow(id));
}

/** `PUT /api/editor/flows/:flowId` (con `If-Match`). */
export async function handleUpdateFlow(request: Request, params: { flowId: string }): Promise<Response> {
  const rejected = rejectedByFrontier(request);
  if (rejected) return rejected;
  const id = validFlowId(params);
  if (id === null) return notFoundFlow();
  const ifMatch = readIfMatch(request);
  if (!ifMatch.ok) return failureResponse(ifMatch);
  const body = await readFlowBody(request);
  if (!body.ok) return failureResponse(body);
  return respond('PUT', TEMPLATES.editorFlow, 'json', () => operations.updateFlow(id, body.value, ifMatch.value));
}

/** `POST /api/editor/flows/:flowId/versions` (con `If-Match`, sin cuerpo). */
export async function handlePublishFlow(request: Request, params: { flowId: string }): Promise<Response> {
  const rejected = rejectedByFrontier(request);
  if (rejected) return rejected;
  const id = validFlowId(params);
  if (id === null) return notFoundFlow();
  const ifMatch = readIfMatch(request);
  if (!ifMatch.ok) return failureResponse(ifMatch);
  return respond('POST', TEMPLATES.editorVersions, 'json', () => operations.publishFlow(id, ifMatch.value));
}

/** `DELETE /api/editor/flows/:flowId` (con `If-Match`, sin cuerpo). */
export async function handleDeleteFlow(request: Request, params: { flowId: string }): Promise<Response> {
  const rejected = rejectedByFrontier(request);
  if (rejected) return rejected;
  const id = validFlowId(params);
  if (id === null) return notFoundFlow();
  const ifMatch = readIfMatch(request);
  if (!ifMatch.ok) return failureResponse(ifMatch);
  return respond('DELETE', TEMPLATES.editorFlow, 'delete', () => operations.deleteFlow(id, ifMatch.value));
}

/** Cualquier otra ruta o método de `/api`: 404 sin llamar a la API. */
export function handleNotFound(): Response {
  return errorResponse(404, 'not_found');
}
