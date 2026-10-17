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
