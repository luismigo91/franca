import type { UserInput } from '@franca/engine';

/** Estados de una conversación en la API. */
export type ConversationStatus = 'waiting' | 'ended' | 'failed' | 'expired';

const STATUSES: readonly string[] = ['waiting', 'ended', 'failed', 'expired'];

/** Error de la conversación (`error` del recurso). */
export interface ConversationError {
  code: string;
  nodeId: string;
}

/** Lo que comparten el recurso y el elemento de un listado (la forma la fija `conversation-resources.ts` de la API). */
export interface ConversationSummary {
  id: string;
  flowId: string;
  version: number;
  contactId: string | null;
  status: ConversationStatus;
  revision: number;
  processing: boolean;
  outcome: string | null;
  error: ConversationError | null;
  costUsd: number;
  costLimitReached: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

/** El recurso conversación: las quince claves del contrato. `pendingInput` llega sin tipar y se lee con `readPendingQuestion`. */
export interface ConversationResource extends ConversationSummary {
  pendingInput: unknown;
}

/** Resumen de flujo del listado `GET /flows`. */
export interface FlowSummary {
  id: string;
  name: string;
  revision: number;
  latestVersion: number | null;
  unpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lo que deja pasar la web de `GET /flows/:flowId/versions/:version`. */
export interface FlowVersionName {
  flowId: string;
  version: number;
  name: string;
}

/** Página de la API. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Entrada de la transcripción: la del usuario o un evento del flujo, sin tipar (`readEvent` la lee). */
export type TranscriptItem =
  | { seq: number; at: string; role: 'user'; input: unknown }
  | { seq: number; at: string; role: 'flow'; event: unknown };

/** Respuesta de un avance: el recurso y los eventos sin tipar. */
export interface AdvanceBody {
  conversation: ConversationResource;
  events: unknown[];
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function readError(value: unknown): ConversationError | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || typeof value.code !== 'string' || typeof value.nodeId !== 'string') return undefined;
  return { code: value.code, nodeId: value.nodeId };
}

/** Lee el resumen de un listado o `null` si no tiene la forma de la API. */
export function readConversationSummary(value: unknown): ConversationSummary | null {
  if (!isObject(value)) return null;
  const error = readError(value.error);
  if (
    typeof value.id !== 'string' ||
    typeof value.flowId !== 'string' ||
    !isInteger(value.version) ||
    !isNullableString(value.contactId) ||
    typeof value.status !== 'string' ||
    !STATUSES.includes(value.status) ||
    !isInteger(value.revision) ||
    typeof value.processing !== 'boolean' ||
    !isNullableString(value.outcome) ||
    error === undefined ||
    typeof value.costUsd !== 'number' ||
    typeof value.costLimitReached !== 'boolean' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isNullableString(value.expiresAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    flowId: value.flowId,
    version: value.version,
    contactId: value.contactId,
    status: value.status as ConversationStatus,
    revision: value.revision,
    processing: value.processing,
    outcome: value.outcome,
    error,
    costUsd: value.costUsd,
    costLimitReached: value.costLimitReached,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
  };
}

/** Lee el recurso conversación o `null` si no tiene la forma de la API. */
export function readConversationResource(value: unknown): ConversationResource | null {
  const summary = readConversationSummary(value);
  if (summary === null || !isObject(value)) return null;
  return { ...summary, pendingInput: value.pendingInput ?? null };
}

/** Lee un resumen de flujo del listado. */
export function readFlowSummary(value: unknown): FlowSummary | null {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isInteger(value.revision) ||
    !(value.latestVersion === null || isInteger(value.latestVersion)) ||
    typeof value.unpublishedChanges !== 'boolean' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    revision: value.revision,
    latestVersion: value.latestVersion,
    unpublishedChanges: value.unpublishedChanges,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

/** Lee `{flowId, version, name}`. */
export function readFlowVersionName(value: unknown): FlowVersionName | null {
  if (!isObject(value) || typeof value.flowId !== 'string' || !isInteger(value.version) || typeof value.name !== 'string') return null;
  return { flowId: value.flowId, version: value.version, name: value.name };
}

/** Lee una página con un lector de elementos; descarta los elementos que no tienen la forma esperada. */
export function readPage<T>(value: unknown, readItem: (item: unknown) => T | null): Page<T> | null {
  if (!isObject(value) || !Array.isArray(value.items) || !isInteger(value.total) || !isInteger(value.limit) || !isInteger(value.offset)) return null;
  const items: T[] = [];
  for (const raw of value.items as unknown[]) {
    const item = readItem(raw);
    if (item !== null) items.push(item);
  }
  return { items, total: value.total, limit: value.limit, offset: value.offset };
}

/** Lee una entrada de la transcripción. */
export function readTranscriptItem(value: unknown): TranscriptItem | null {
  if (!isObject(value) || !isInteger(value.seq) || typeof value.at !== 'string') return null;
  if (value.role === 'user') return { seq: value.seq, at: value.at, role: 'user', input: value.input };
  if (value.role === 'flow') return { seq: value.seq, at: value.at, role: 'flow', event: value.event };
  return null;
}

/** Lee la respuesta de un avance (`201` o `200`). */
export function readAdvance(value: unknown): AdvanceBody | null {
  if (!isObject(value) || !Array.isArray(value.events)) return null;
  const conversation = readConversationResource(value.conversation);
  return conversation === null ? null : { conversation, events: value.events as unknown[] };
}

/** Lo que el chat manda como respuesta (el tipo del motor). */
export type ChatInput = UserInput;
