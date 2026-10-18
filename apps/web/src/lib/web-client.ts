import { isApiErrorCode } from '@/config/api-error-codes';
import { BROWSER_ADVANCE_TIMEOUT_MS, BROWSER_READ_TIMEOUT_MS } from '@/config/limits';
import { WEB_ENDPOINTS } from '@/config/endpoints';
import { isWebErrorCode } from '@/config/web-error-codes';
import {
  readAdvance,
  readConversationResource,
  readConversationSummary,
  readFlowSummary,
  readFlowVersionName,
  readPage,
  readTranscriptItem,
  type AdvanceBody,
  type ChatInput,
  type ConversationResource,
  type ConversationSummary,
  type FlowSummary,
  type FlowVersionName,
  type Page,
  type TranscriptItem,
} from '@/lib/chat/api-types';
import type { ChatErrorCode } from '@/lib/chat/copy';
import { readFlowResource, readVersionResource, type FlowResource, type VersionResource } from '@/lib/editor/api-types';

/**
 * Resultado de una llamada del navegador. `status` es `null` solo cuando no hubo respuesta (`network_error`).
 * `currentRevision` llega en un 412 `revision_mismatch`.
 */
export type ClientResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number | null; code: ChatErrorCode; currentRevision?: number };

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const ERROR_SHAPE = /^[a-z][a-z0-9_]{0,63}$/;

function failure(status: number | null, code: ChatErrorCode, currentRevision?: number): ClientResult<never> {
  return currentRevision === undefined ? { ok: false, status, code } : { ok: false, status, code, currentRevision };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Código de un cuerpo de error: uno conocido, o `unknown` si no se lee o no se conoce. */
function readErrorCode(body: unknown): { code: ChatErrorCode; currentRevision?: number } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { code: 'unknown' };
  const { error, currentRevision } = body as Record<string, unknown>;
  const code: ChatErrorCode = typeof error === 'string' && ERROR_SHAPE.test(error) && (isApiErrorCode(error) || isWebErrorCode(error)) ? error : 'unknown';
  return typeof currentRevision === 'number' && Number.isInteger(currentRevision) ? { code, currentRevision } : { code };
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

/**
 * Hace una llamada y la lee por su estado (D9). `network_error` es **solo** un `fetch` rechazado, abortado o con el
 * plazo agotado. Un 4xx/5xx sin cuerpo (el 403 de la frontera, un 405) es `unknown` con su estado.
 */
async function call(fetchImpl: Fetch, url: string, options: RequestOptions): Promise<ClientResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const forward = () => controller.abort();
  options.signal?.addEventListener('abort', forward, { once: true });
  try {
    if (options.signal?.aborted) return failure(null, 'network_error');
    // Sin `mode`: siempre `cors`, el de por defecto. Un `no-cors` mandaría `Origin: null` y la frontera lo rechazaría.
    const init: RequestInit = { method: options.method, cache: 'no-store', credentials: 'same-origin', signal: controller.signal };
    if (options.headers) init.headers = options.headers;
    if (options.body !== undefined) init.body = options.body;
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(url, init);
      text = response.status === 204 ? '' : await response.text();
    } catch {
      return failure(null, 'network_error');
    }
    if (response.status === 204) return { ok: true, status: 204, body: null };
    const body = text === '' ? undefined : parseJson(text);
    if (response.status >= 200 && response.status < 300) {
      return body === undefined ? failure(response.status, 'invalid_api_response') : { ok: true, status: response.status, body };
    }
    const { code, currentRevision } = readErrorCode(body);
    return failure(response.status, code, currentRevision);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forward);
  }
}

/** Convierte el cuerpo con un lector; un cuerpo con otra forma es `invalid_api_response`. */
function shaped<T, U>(result: ClientResult<T>, read: (body: T) => U | null): ClientResult<U> {
  if (!result.ok) return result;
  const value = read(result.body);
  return value === null ? failure(result.status, 'invalid_api_response') : { ok: true, status: result.status, body: value };
}

/** Las ocho llamadas del navegador, contra las rutas de la web (`WEB_ENDPOINTS`). */
export interface WebClient {
  listFlows(offset: number, signal?: AbortSignal): Promise<ClientResult<Page<FlowSummary>>>;
  getFlowVersion(flowId: string, version: number, signal?: AbortSignal): Promise<ClientResult<FlowVersionName>>;
  listConversations(offset: number, signal?: AbortSignal): Promise<ClientResult<Page<ConversationSummary>>>;
  getConversation(id: string, signal?: AbortSignal): Promise<ClientResult<ConversationResource>>;
  getTranscriptPage(id: string, offset: number, signal?: AbortSignal): Promise<ClientResult<Page<TranscriptItem>>>;
  /** Con `contactId` exactamente `''`, el cuerpo es `{"flowId"}` sin la clave `contactId`. */
  createConversation(flowId: string, contactId: string, signal?: AbortSignal): Promise<ClientResult<AdvanceBody>>;
  /** Manda `If-Match: "<revision>"`. */
  sendInput(id: string, input: ChatInput, revision: number, signal?: AbortSignal): Promise<ClientResult<AdvanceBody>>;
  deleteConversation(id: string, signal?: AbortSignal): Promise<ClientResult<null>>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Crea el cliente con un `fetch` inyectado (en los tests, uno falso).
 *
 * @param fetchImpl El `fetch` del navegador.
 * @returns Las ocho llamadas del chat.
 */
export function createWebClient(fetchImpl: Fetch): WebClient {
  const read = { timeoutMs: BROWSER_READ_TIMEOUT_MS };
  return {
    async listFlows(offset, signal) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.flows(offset), { method: 'GET', ...read, signal });
      return shaped(result, (body) => readPage(body, readFlowSummary));
    },
    async getFlowVersion(flowId, version, signal) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.flowVersion(flowId, version), { method: 'GET', ...read, signal });
      return shaped(result, readFlowVersionName);
    },
    async listConversations(offset, signal) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.conversationList(offset), { method: 'GET', ...read, signal });
      return shaped(result, (body) => readPage(body, readConversationSummary));
    },
    async getConversation(id, signal) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.conversation(id), { method: 'GET', ...read, signal });
      return shaped(result, readConversationResource);
    },
    async getTranscriptPage(id, offset, signal) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.transcript(id, offset), { method: 'GET', ...read, signal });
      return shaped(result, (body) => readPage(body, readTranscriptItem));
    },
    async createConversation(flowId, contactId, signal) {
      const body = JSON.stringify(contactId === '' ? { flowId } : { flowId, contactId });
      const result = await call(fetchImpl, WEB_ENDPOINTS.conversations, { method: 'POST', body, headers: JSON_HEADERS, timeoutMs: BROWSER_ADVANCE_TIMEOUT_MS, signal });
      return shaped(result, readAdvance);
    },
    async sendInput(id, input, revision, signal) {
      const headers = { ...JSON_HEADERS, 'If-Match': `"${revision}"` };
      const result = await call(fetchImpl, WEB_ENDPOINTS.inputs(id), { method: 'POST', body: JSON.stringify({ input }), headers, timeoutMs: BROWSER_ADVANCE_TIMEOUT_MS, signal });
      return shaped(result, readAdvance);
    },
    async deleteConversation(id, signal) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.conversation(id), { method: 'DELETE', ...read, signal });
      return result.ok ? { ok: true, status: result.status, body: null } : result;
    },
  };
}

/** El cliente del navegador: el único sitio de la web donde se usa `fetch` (ESLint lo impone). */
export const webClient: WebClient = createWebClient((input, init) => fetch(input, init));

/** Las seis llamadas del navegador del editor, contra las rutas `/api/editor/flows/**` de la web (`WEB_ENDPOINTS`). */
export interface EditorClient {
  listFlows(offset: number, signal?: AbortSignal): Promise<ClientResult<Page<FlowSummary>>>;
  getFlow(flowId: string, signal?: AbortSignal): Promise<ClientResult<FlowResource>>;
  /** Crea un flujo con su texto JSON (201). */
  createFlow(text: string): Promise<ClientResult<FlowResource>>;
  /** Guarda el borrador con `If-Match: "<revision>"`. */
  updateFlow(flowId: string, text: string, revision: number): Promise<ClientResult<FlowResource>>;
  /** Publica con `If-Match: "<revision>"`; `status` 201 (versión nueva) o 200 (ya existía). */
  publishFlow(flowId: string, revision: number): Promise<ClientResult<VersionResource>>;
  /** Borra con `If-Match: "<revision>"` (204). */
  deleteFlow(flowId: string, revision: number): Promise<ClientResult<null>>;
}

const ifMatch = (revision: number) => ({ 'If-Match': `"${revision}"` });

/**
 * Crea el cliente del editor con un `fetch` inyectado (en los tests, uno falso).
 *
 * @param fetchImpl El `fetch` del navegador.
 * @returns Las seis llamadas del editor.
 */
export function createEditorClient(fetchImpl: Fetch): EditorClient {
  const read = { timeoutMs: BROWSER_READ_TIMEOUT_MS };
  return {
    async listFlows(offset, signal) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.editorFlows(offset), { method: 'GET', ...read, signal });
      return shaped(result, (body) => readPage(body, readFlowSummary));
    },
    async getFlow(flowId, signal) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.editorFlow(flowId), { method: 'GET', ...read, signal });
      return shaped(result, readFlowResource);
    },
    async createFlow(text) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.editorFlowCreate, { method: 'POST', body: text, headers: JSON_HEADERS, ...read });
      return shaped(result, readFlowResource);
    },
    async updateFlow(flowId, text, revision) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.editorFlow(flowId), { method: 'PUT', body: text, headers: { ...JSON_HEADERS, ...ifMatch(revision) }, ...read });
      return shaped(result, readFlowResource);
    },
    async publishFlow(flowId, revision) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.editorFlowVersions(flowId), { method: 'POST', headers: ifMatch(revision), ...read });
      return shaped(result, readVersionResource);
    },
    async deleteFlow(flowId, revision) {
      const result = await call(fetchImpl, WEB_ENDPOINTS.editorFlow(flowId), { method: 'DELETE', headers: ifMatch(revision), ...read });
      return result.ok ? { ok: true, status: result.status, body: null } : result;
    },
  };
}

/** El cliente del editor: usa el mismo `fetch` que el del chat, este fichero es el único con `fetch` (ESLint lo impone). */
export const editorClient: EditorClient = createEditorClient((input, init) => fetch(input, init));
