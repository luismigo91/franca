import { describe, expect, it } from 'vitest';
import { toConversationResource, toConversationSummary, toTranscriptItem, type ConversationRow } from './conversation-resources.js';

const T = new Date('2026-10-17T10:00:00.000Z');
const plus = (ms: number) => new Date(T.getTime() + ms);

const INPUT_EVENT = { type: 'input', nodeId: 'p', inputType: 'text', attempt: 1, reason: null };

function row(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90',
    flowId: 'pregunta',
    version: 1,
    contactId: null,
    status: 'waiting',
    revision: 1,
    pendingInputJson: JSON.stringify(INPUT_EVENT),
    outcome: null,
    errorCode: null,
    errorNodeId: null,
    costUsd: 0,
    costLimitReached: false,
    claimToken: null,
    claimedAt: null,
    createdAt: T,
    updatedAt: T,
    expiresAt: plus(30 * 60_000),
    ...overrides,
  };
}

const RESOURCE_KEYS = ['id', 'flowId', 'version', 'contactId', 'status', 'revision', 'processing', 'pendingInput', 'outcome', 'error', 'costUsd', 'costLimitReached', 'createdAt', 'updatedAt', 'expiresAt'];

describe('toConversationResource', () => {
  it('waiting: las quince claves exactas, en orden', () => {
    const resource = toConversationResource(row(), plus(1000));
    expect(Object.keys(resource)).toEqual(RESOURCE_KEYS);
    expect(resource).toEqual({
      id: '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90',
      flowId: 'pregunta',
      version: 1,
      contactId: null,
      status: 'waiting',
      revision: 1,
      processing: false,
      pendingInput: INPUT_EVENT,
      outcome: null,
      error: null,
      costUsd: 0,
      costLimitReached: false,
      createdAt: '2026-10-17T10:00:00.000Z',
      updatedAt: '2026-10-17T10:00:00.000Z',
      expiresAt: '2026-10-17T10:30:00.000Z',
    });
  });

  it('expired: waiting guardado con now >= expiresAt, sin pendingInput y con el mismo expiresAt', () => {
    const expiresAt = plus(30 * 60_000);
    const before = toConversationResource(row(), new Date(expiresAt.getTime() - 1));
    const at = toConversationResource(row(), expiresAt);
    expect(before.status).toBe('waiting');
    expect(before.pendingInput).toEqual(INPUT_EVENT);
    expect(at.status).toBe('expired');
    expect(at.pendingInput).toBeNull();
    expect(at.expiresAt).toBe('2026-10-17T10:30:00.000Z');
  });

  it('processing: reclamación viva a 299 999 ms y no a 300 000 ms', () => {
    const claimed = row({ claimToken: '11111111-1111-4111-8111-111111111111', claimedAt: T });
    expect(toConversationResource(claimed, plus(299_999)).processing).toBe(true);
    expect(toConversationResource(claimed, plus(300_000)).processing).toBe(false);
    expect(toConversationResource(row(), plus(1)).processing).toBe(false);
  });

  it('ended: outcome, sin pendingInput ni expiresAt', () => {
    const resource = toConversationResource(row({ status: 'ended', outcome: 'ok', pendingInputJson: null, expiresAt: null }), plus(1e12));
    expect(resource).toMatchObject({ status: 'ended', outcome: 'ok', pendingInput: null, error: null, expiresAt: null });
  });

  it('failed: error con code y nodeId', () => {
    const resource = toConversationResource(row({ status: 'failed', errorCode: 'unsupported_node', errorNodeId: 'enviar-crm', pendingInputJson: null, expiresAt: null }), plus(1));
    expect(resource).toMatchObject({ status: 'failed', error: { code: 'unsupported_node', nodeId: 'enviar-crm' }, pendingInput: null, outcome: null });
    expect(Object.keys(resource.error!)).toEqual(['code', 'nodeId']);
  });

  it('el estado del motor no sale: el recurso no tiene state ni claves del token', () => {
    const resource = toConversationResource({ ...row(), state: '{"variables":{}}' } as ConversationRow, plus(1));
    expect(JSON.stringify(resource)).not.toContain('variables');
    expect(JSON.stringify(resource)).not.toContain('claimToken');
  });
});

describe('toConversationSummary', () => {
  it('es el recurso sin pendingInput, con el resto de claves y orden', () => {
    const summary = toConversationSummary(row(), plus(1));
    expect(Object.keys(summary)).toEqual(RESOURCE_KEYS.filter((key) => key !== 'pendingInput'));
    expect(summary).not.toHaveProperty('pendingInput');
  });

  it('deriva expired y processing igual que el recurso', () => {
    const summary = toConversationSummary(row({ claimToken: 't', claimedAt: T }), plus(30 * 60_000));
    expect(summary.status).toBe('expired');
    expect(summary.processing).toBe(false);
  });
});

describe('toTranscriptItem', () => {
  it('entrada del usuario: {seq, at, role, input}', () => {
    const item = toTranscriptItem({ seq: 4, at: plus(5000), role: 'user', payload: JSON.stringify({ text: ' Ana ' }) });
    expect(item).toEqual({ seq: 4, at: '2026-10-17T10:00:05.000Z', role: 'user', input: { text: ' Ana ' } });
    expect(Object.keys(item)).toEqual(['seq', 'at', 'role', 'input']);
  });

  it('evento del motor: {seq, at, role, event}', () => {
    const item = toTranscriptItem({ seq: 5, at: plus(5000), role: 'flow', payload: JSON.stringify(INPUT_EVENT) });
    expect(item).toEqual({ seq: 5, at: '2026-10-17T10:00:05.000Z', role: 'flow', event: INPUT_EVENT });
    expect(Object.keys(item)).toEqual(['seq', 'at', 'role', 'event']);
  });

  it('la entrada del usuario puede ser cualquier JSON, incluso null o un texto', () => {
    expect(toTranscriptItem({ seq: 1, at: T, role: 'user', payload: 'null' })).toMatchObject({ input: null });
    expect(toTranscriptItem({ seq: 1, at: T, role: 'user', payload: '"grande"' })).toMatchObject({ input: 'grande' });
  });
});
