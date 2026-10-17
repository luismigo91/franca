import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ConversationsRepository } from './conversations.repository.js';

const NOW = new Date('2026-10-17T10:00:00.000Z');

function stub(rows: unknown[] = []) {
  const transaction = vi.fn(() => Promise.reject(new Error('los listados no abren transacción')));
  const prisma = {
    $transaction: transaction,
    $queryRaw: vi.fn().mockResolvedValue(rows),
    conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'x' }]), count: vi.fn().mockResolvedValue(3) },
  };
  return { prisma, repository: new ConversationsRepository(prisma as unknown as PrismaService), transaction };
}

describe('ConversationsRepository: listado', () => {
  it('página y total salen de dos consultas, sin $transaction', async () => {
    const { prisma, repository, transaction } = stub();
    await expect(repository.listConversations({}, { limit: 10, offset: 5 }, NOW)).resolves.toEqual({ items: [{ id: 'x' }], total: 3 });
    expect(transaction).not.toHaveBeenCalled();
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: 5, take: 10 }));
    // La selección nunca incluye el estado del motor.
    expect(prisma.conversation.findMany.mock.calls[0]![0].select).not.toHaveProperty('state');
  });

  it.each([
    ['waiting', { status: 'waiting', expiresAt: { gt: NOW } }],
    ['expired', { status: 'waiting', expiresAt: { lte: NOW } }],
    ['ended', { status: 'ended' }],
    ['failed', { status: 'failed' }],
  ] as const)('el filtro status=%s se deriva de expires_at con el mismo now', async (status, expected) => {
    const { prisma, repository } = stub();
    await repository.listConversations({ status, flowId: 'hola' }, { limit: 20, offset: 0 }, NOW);
    expect(prisma.conversation.count).toHaveBeenCalledWith({ where: { flowId: 'hola', ...expected } });
  });
});

describe('ConversationsRepository: transcripción', () => {
  it('enlaza el rango como bigint, calculado en JS: offset 2147483647 no desborda int4', async () => {
    const { prisma, repository } = stub([{ total: 0, seq: null, at: null, role: null, payload: null }]);
    await expect(repository.listEntries('00000000-0000-4000-8000-000000000000', { limit: 100, offset: 2_147_483_647 })).resolves.toEqual({ total: 0, items: [] });
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0]! as [TemplateStringsArray, ...unknown[]];
    expect(values).toEqual([BigInt(2_147_483_647), BigInt(2_147_483_747), '00000000-0000-4000-8000-000000000000']);
    // Una sola sentencia, sin suma en SQL.
    const sql = strings.join('?');
    expect(sql).not.toMatch(/\+/);
    expect(sql).toContain('::bigint');
  });

  it('sin filas la conversación no existe', async () => {
    const { repository } = stub([]);
    await expect(repository.listEntries('00000000-0000-4000-8000-000000000000', { limit: 20, offset: 0 })).resolves.toBeNull();
  });

  it('descarta la fila vacía del LEFT JOIN y conserva las entradas', async () => {
    const at = new Date(NOW);
    const { repository } = stub([
      { total: 2, seq: 1, at, role: 'flow', payload: '{"a":1}' },
      { total: 2, seq: 2, at, role: 'user', payload: '{"text":"x"}' },
    ]);
    await expect(repository.listEntries('00000000-0000-4000-8000-000000000000', { limit: 20, offset: 0 })).resolves.toEqual({
      total: 2,
      items: [
        { seq: 1, at, role: 'flow', payload: '{"a":1}' },
        { seq: 2, at, role: 'user', payload: '{"text":"x"}' },
      ],
    });
  });
});

describe('ConversationsRepository: valores de contacto', () => {
  /** Un `tx` falso que cuenta las llamadas: la regresión es de número de sentencias, no de tiempo. */
  function fakeTransaction() {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([{ epoch: 'e1' }]).mockResolvedValueOnce([{ deleted: false }]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      conversation: { create: vi.fn().mockResolvedValue({}), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'x' }) },
      conversationEntry: { createMany: vi.fn().mockResolvedValue({}) },
      contactValue: { upsert: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = { $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
    return { tx, repository: new ConversationsRepository(prisma as unknown as PrismaService) };
  }

  const write = (changes: number) => ({
    status: 'ended' as const,
    state: null,
    pendingInputJson: null,
    outcome: null,
    errorCode: null,
    errorNodeId: null,
    costUsd: 0,
    costLimitReached: false,
    expiresAt: null,
    entries: [],
    contactUpserts: Array.from({ length: changes }, (_, index) => [`v${index}`, String(index)] as [string, string]),
    contactDeletes: Array.from({ length: changes }, (_, index) => `d${index}`),
  });

  it('con 1000 cambios hace una sola escritura por lote y ningún upsert fila a fila', async () => {
    const { tx, repository } = fakeTransaction();
    const result = await repository.insertConversation({ id: 'i', flowId: 'f', version: 1, contactId: 'c-1', contactEpoch: 'e1', now: NOW, write: write(1000) });
    expect(result.kind).toBe('created');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.contactValue.upsert).not.toHaveBeenCalled();
    expect(tx.contactValue.deleteMany).toHaveBeenCalledTimes(1);
    // Los 1000 nombres y valores viajan como dos arrays, no como 1000 parámetros.
    const values = tx.$executeRaw.mock.calls[0]!.slice(1) as unknown[];
    expect(values).toHaveLength(3);
    expect((values[1] as string[]).length).toBe(1000);
    expect((values[2] as string[]).length).toBe(1000);
  });

  it('sin cambios no escribe nada', async () => {
    const { tx, repository } = fakeTransaction();
    await repository.insertConversation({ id: 'i', flowId: 'f', version: 1, contactId: 'c-1', contactEpoch: 'e1', now: NOW, write: write(0) });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.contactValue.deleteMany).not.toHaveBeenCalled();
  });
});
