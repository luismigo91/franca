import type { Conversation, ConversationEntry } from '../generated/prisma/client.js';
import { hasExpired, isClaimActive } from './conversation-timing.js';

/** Columnas que lee un recurso (sin `state`: puede ser de megabytes y nunca sale de la API). */
export type ConversationRow = Pick<
  Conversation,
  | 'id'
  | 'flowId'
  | 'version'
  | 'contactId'
  | 'status'
  | 'revision'
  | 'pendingInputJson'
  | 'outcome'
  | 'errorCode'
  | 'errorNodeId'
  | 'costUsd'
  | 'costLimitReached'
  | 'claimToken'
  | 'claimedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'expiresAt'
>;

/** Lo que se lee de una entrada de la transcripción. */
export type EntryRow = Pick<ConversationEntry, 'seq' | 'at' | 'role' | 'payload'>;

export type ConversationStatusResource = 'waiting' | 'ended' | 'failed' | 'expired';

/** Elemento de un listado: el recurso sin `pendingInput`. Las claves salen en este orden. */
export interface ConversationSummary {
  id: string;
  flowId: string;
  version: number;
  contactId: string | null;
  status: ConversationStatusResource;
  revision: number;
  processing: boolean;
  outcome: string | null;
  error: { code: string; nodeId: string } | null;
  costUsd: number;
  costLimitReached: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

/** El recurso conversación: las quince claves del contrato, en este orden. */
export interface ConversationResource {
  id: string;
  flowId: string;
  version: number;
  contactId: string | null;
  status: ConversationStatusResource;
  revision: number;
  processing: boolean;
  pendingInput: unknown;
  outcome: string | null;
  error: { code: string; nodeId: string } | null;
  costUsd: number;
  costLimitReached: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export type TranscriptItem =
  | { seq: number; at: string; role: 'user'; input: unknown }
  | { seq: number; at: string; role: 'flow'; event: unknown };

/** `waiting` guardado y vencido es `expired`; el resto, tal cual. `expired` nunca se guarda. */
export function statusOf(row: Pick<ConversationRow, 'status' | 'expiresAt'>, now: Date): ConversationStatusResource {
  return row.status === 'waiting' && hasExpired(row.expiresAt, now) ? 'expired' : row.status;
}

function summaryOf(row: ConversationRow, now: Date): { status: ConversationStatusResource; summary: ConversationSummary } {
  const status = statusOf(row, now);
  return {
    status,
    summary: {
      id: row.id,
      flowId: row.flowId,
      version: row.version,
      contactId: row.contactId,
      status,
      revision: row.revision,
      processing: isClaimActive(row.claimToken, row.claimedAt, now),
      outcome: row.outcome,
      error: row.errorCode !== null && row.errorNodeId !== null ? { code: row.errorCode, nodeId: row.errorNodeId } : null,
      costUsd: row.costUsd,
      costLimitReached: row.costLimitReached,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    },
  };
}

/**
 * Elemento de listado de una conversación.
 *
 * @param row Fila sin `state`.
 * @param now Instante con el que se derivan `expired` y `processing`.
 * @returns El recurso sin `pendingInput`.
 */
export function toConversationSummary(row: ConversationRow, now: Date): ConversationSummary {
  return summaryOf(row, now).summary;
}

/**
 * Recurso completo de una conversación. `status` `expired` y `processing` se derivan con `now`; en `expired` el
 * `pendingInput` es `null`.
 *
 * @param row Fila sin `state`.
 * @param now Instante actual del reloj de la API.
 * @returns El recurso con las quince claves.
 */
export function toConversationResource(row: ConversationRow, now: Date): ConversationResource {
  const { status, summary } = summaryOf(row, now);
  const pendingInput = status === 'waiting' && row.pendingInputJson !== null ? (JSON.parse(row.pendingInputJson) as unknown) : null;
  return {
    id: summary.id,
    flowId: summary.flowId,
    version: summary.version,
    contactId: summary.contactId,
    status: summary.status,
    revision: summary.revision,
    processing: summary.processing,
    pendingInput,
    outcome: summary.outcome,
    error: summary.error,
    costUsd: summary.costUsd,
    costLimitReached: summary.costLimitReached,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    expiresAt: summary.expiresAt,
  };
}

/**
 * Entrada de la transcripción: `{seq, at, role: "user", input}` o `{seq, at, role: "flow", event}`.
 *
 * @param row Fila de `conversation_entries`.
 * @returns El elemento, con la fecha en ISO 8601.
 */
export function toTranscriptItem(row: EntryRow): TranscriptItem {
  const payload = JSON.parse(row.payload) as unknown;
  const at = row.at.toISOString();
  return row.role === 'user' ? { seq: row.seq, at, role: 'user', input: payload } : { seq: row.seq, at, role: 'flow', event: payload };
}
