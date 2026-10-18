import { LIST_PAGE_SIZE, TRANSCRIPT_PAGE_SIZE } from '@/config/limits';

/**
 * Única fuente de las URLs que llama el navegador: las rutas del servidor de la web (D3). Los argumentos llegan del
 * código de la web, y los ids se codifican igualmente.
 */
export const WEB_ENDPOINTS = {
  flows: (offset: number) => `/api/flows?offset=${offset}`,
  flowVersion: (flowId: string, version: number) => `/api/flows/${encodeURIComponent(flowId)}/versions/${version}`,
  conversations: '/api/conversations',
  conversationList: (offset: number) => `/api/conversations?offset=${offset}`,
  conversation: (id: string) => `/api/conversations/${encodeURIComponent(id)}`,
  transcript: (id: string, offset: number) => `/api/conversations/${encodeURIComponent(id)}/transcript?offset=${offset}`,
  inputs: (id: string) => `/api/conversations/${encodeURIComponent(id)}/inputs`,
  // Editor de flujos: rutas propias bajo /api/editor/flows (`GET /api/flows` es la lista de publicados del chat).
  editorFlows: (offset: number) => `/api/editor/flows?offset=${offset}`,
  editorFlowCreate: '/api/editor/flows',
  editorFlow: (flowId: string) => `/api/editor/flows/${encodeURIComponent(flowId)}`,
  editorFlowVersions: (flowId: string) => `/api/editor/flows/${encodeURIComponent(flowId)}/versions`,
} as const;

/** Páginas de la web (rutas del navegador, no de la API). */
export const WEB_PAGES = {
  home: '/',
  flows: '/flujos',
  conversation: (id: string) => `/conversaciones/${encodeURIComponent(id)}`,
  flowEditor: (flowId: string) => `/flujos/${encodeURIComponent(flowId)}`,
} as const;

/**
 * Las catorce operaciones de la API que usa el servidor de la web (D3 de `web-chat` y D2 de `web-editor`). Reciben argumentos **ya validados** en
 * `src/server/ids.ts` y arman la ruta; el navegador no elige `limit` ni `published`.
 */
export const API_OPERATIONS = {
  listPublishedFlows: (offset: number) => `/flows?published=true&limit=${LIST_PAGE_SIZE}&offset=${offset}`,
  getFlowVersion: (flowId: string, version: number) => `/flows/${flowId}/versions/${version}`,
  listConversations: (offset: number) => `/conversations?limit=${LIST_PAGE_SIZE}&offset=${offset}`,
  getConversation: (conversationId: string) => `/conversations/${conversationId}`,
  getTranscriptPage: (conversationId: string, offset: number) =>
    `/conversations/${conversationId}/transcript?limit=${TRANSCRIPT_PAGE_SIZE}&offset=${offset}`,
  createConversation: () => '/conversations',
  sendConversationInput: (conversationId: string) => `/conversations/${conversationId}/inputs`,
  deleteConversation: (conversationId: string) => `/conversations/${conversationId}`,
  // Editor de flujos: todos los flujos vivos, sin `published`.
  listFlows: (offset: number) => `/flows?limit=${LIST_PAGE_SIZE}&offset=${offset}`,
  getFlow: (flowId: string) => `/flows/${flowId}`,
  createFlow: () => '/flows',
  updateFlow: (flowId: string) => `/flows/${flowId}`,
  publishFlow: (flowId: string) => `/flows/${flowId}/versions`,
  deleteFlow: (flowId: string) => `/flows/${flowId}`,
} as const;
