import type { AdvanceBody, ConversationResource, Page, TranscriptItem } from '@/lib/chat/api-types';

export const CONVERSATION_ID = '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90';
export const AT = '2026-10-17T10:30:00.000Z';

/** Un recurso con las quince claves de la API, en su orden. */
export function resourceOf(overrides: Partial<ConversationResource> = {}): ConversationResource {
  return {
    id: CONVERSATION_ID,
    flowId: 'pregunta',
    version: 1,
    contactId: null,
    status: 'waiting',
    revision: 1,
    processing: false,
    pendingInput: { type: 'input', nodeId: 'p', inputType: 'text', attempt: 1, reason: null },
    outcome: null,
    error: null,
    costUsd: 0,
    costLimitReached: false,
    createdAt: AT,
    updatedAt: AT,
    expiresAt: '2026-10-18T10:30:00.000Z',
    ...overrides,
  };
}

export function advanceOf(overrides: Partial<ConversationResource>, events: unknown[]): AdvanceBody {
  return { conversation: resourceOf(overrides), events };
}

export function pageOf<T>(items: T[], total = items.length, offset = 0): Page<T> {
  return { items, total, limit: 100, offset };
}

export const flowItem = (seq: number, event: unknown): TranscriptItem => ({ seq, at: AT, role: 'flow', event });
export const userItem = (seq: number, input: unknown): TranscriptItem => ({ seq, at: AT, role: 'user', input });

export const messageEvent = (nodeId: string, text: string, typingDelayMs = 0) => ({
  type: 'message',
  nodeId,
  content: [{ kind: 'text', text }],
  typingDelayMs,
});

export const textInputEvent = (nodeId: string, attempt = 1, reason: string | null = null) => ({ type: 'input', nodeId, inputType: 'text', attempt, reason });
