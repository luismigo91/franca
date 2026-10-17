import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FlowsRepository } from './flows.repository.js';

/**
 * Regresión de `api-flows` (QA, ronda 2): los listados iban en `$transaction([findMany, count])`, cuyo `timeout` por
 * defecto (5 s) caducaba con `P2028` antes que el corte de la base y daba 500 en vez de 503. Un lote en `READ COMMITTED`
 * tampoco daba una instantánea común, así que los listados son dos consultas sin transacción.
 */
describe('FlowsRepository: listados', () => {
  const stub = () => {
    const transaction = vi.fn(() => Promise.reject(new Error('los listados no abren transacción')));
    const prisma = {
      $transaction: transaction,
      flow: { findMany: vi.fn().mockResolvedValue([{ id: 'hola' }]), count: vi.fn().mockResolvedValue(7) },
      flowVersion: { findMany: vi.fn().mockResolvedValue([{ version: 2 }]), count: vi.fn().mockResolvedValue(2) },
    };
    return { prisma, repository: new FlowsRepository(prisma as unknown as PrismaService), transaction };
  };

  it('list: página y total salen de dos consultas, sin $transaction', async () => {
    const { prisma, repository, transaction } = stub();
    await expect(repository.list({ published: true }, { limit: 10, offset: 0 })).resolves.toEqual({ items: [{ id: 'hola' }], total: 7 });
    expect(transaction).not.toHaveBeenCalled();
    expect(prisma.flow.count).toHaveBeenCalledWith({ where: { deletedAt: null, latestVersion: { not: null } } });
  });

  it('listVersions: página y total salen de dos consultas, sin $transaction', async () => {
    const { repository, transaction } = stub();
    await expect(repository.listVersions('hola', { limit: 10, offset: 0 })).resolves.toEqual({ items: [{ version: 2 }], total: 2 });
    expect(transaction).not.toHaveBeenCalled();
  });
});
