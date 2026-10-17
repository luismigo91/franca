import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TRANSACTION_MAX_WAIT_MS, TRANSACTION_TIMEOUT_MS } from '../prisma/limits.js';
import type { FlowRow, FlowSummaryRow, VersionRow, VersionSummaryRow } from './flow-resources.js';

export interface NewFlow {
  id: string;
  nameJson: string;
  draft: string;
  now: Date;
}

export type CreateResult = { ok: true; row: FlowRow } | { ok: false; reserved: boolean };

/** La fila de un flujo vivo tomada con `FOR UPDATE`, con todo lo que hace falta para responder sin otra consulta. */
export type LockedRow = FlowRow;

/**
 * Un flujo bloqueado dentro de una transacción: lo que se hace con él se confirma o se deshace junto. Todos los
 * escritores de un flujo toman antes este bloqueo (con `READ COMMITTED` basta).
 */
export interface LockedFlow {
  readonly row: LockedRow;
  /** La última versión publicada, leída bajo el bloqueo. */
  lastVersion(): Promise<VersionRow | null>;
  /** Sustituye el borrador y suma 1 a `revision`. */
  updateDraft(data: { draft: string; nameJson: string; unpublishedChanges: boolean; now: Date }): Promise<FlowRow>;
  /** Crea la versión siguiente y marca el borrador como publicado (no toca `revision` ni `updated_at`). */
  insertVersion(data: { nameJson: string; definition: string; now: Date }): Promise<VersionRow>;
  /** Borrado lógico: el `id` queda reservado. */
  markDeleted(now: Date): Promise<void>;
}

export interface Paging {
  limit: number;
  offset: number;
}

const SUMMARY_SELECT = {
  id: true,
  nameJson: true,
  revision: true,
  latestVersion: true,
  unpublishedChanges: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VERSION_SUMMARY_SELECT = { flowId: true, version: true, nameJson: true, publishedAt: true } as const;

/** El único que habla con Prisma. */
@Injectable()
export class FlowsRepository {
  constructor(protected readonly prisma: PrismaService) {}

  /**
   * Inserta un flujo nuevo con `revision` 1 y sin versiones. Si el `id` ya existe (la clave primaria decide,
   * también entre dos `POST` simultáneos) devuelve si pertenece a un flujo borrado.
   */
  async create(data: NewFlow): Promise<CreateResult> {
    try {
      const row = await this.prisma.flow.create({
        data: {
          id: data.id,
          nameJson: data.nameJson,
          draft: data.draft,
          revision: 1,
          latestVersion: null,
          unpublishedChanges: true,
          createdAt: data.now,
          updatedAt: data.now,
        },
      });
      return { ok: true, row };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.flow.findUnique({ where: { id: data.id }, select: { deletedAt: true } });
      return { ok: false, reserved: existing?.deletedAt != null };
    }
  }

  /** Un flujo que no está borrado, con su borrador. */
  async findActive(id: string): Promise<FlowRow | null> {
    return this.prisma.flow.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * Página de resúmenes (sin `draft`) y total. Dos consultas simultáneas y sin transacción: con `READ COMMITTED` el lote
   * de Prisma tampoco daba una instantánea común, y su `timeout` por defecto (5 s) caducaba con `P2028` antes que el
   * corte de la base, que es lo que debe dar 503.
   */
  async list(filter: { published?: boolean }, page: Paging): Promise<{ items: FlowSummaryRow[]; total: number }> {
    const where: Prisma.FlowWhereInput = { deletedAt: null };
    if (filter.published !== undefined) where.latestVersion = filter.published ? { not: null } : null;
    const [items, total] = await Promise.all([
      this.prisma.flow.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: page.offset,
        take: page.limit,
      }),
      this.prisma.flow.count({ where }),
    ]);
    return { items, total };
  }

  /** Una versión publicada. */
  async findVersion(flowId: string, version: number): Promise<VersionRow | null> {
    return this.prisma.flowVersion.findUnique({ where: { flowId_version: { flowId, version } } });
  }

  /** Página de resúmenes de versión (sin `definition`), de la más nueva a la más antigua, y total (sin transacción: ver `list`). */
  async listVersions(flowId: string, page: Paging): Promise<{ items: VersionSummaryRow[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.flowVersion.findMany({
        where: { flowId },
        select: VERSION_SUMMARY_SELECT,
        orderBy: { version: 'desc' },
        skip: page.offset,
        take: page.limit,
      }),
      this.prisma.flowVersion.count({ where: { flowId } }),
    ]);
    return { items, total };
  }

  /**
   * Ejecuta `fn` con el flujo bloqueado (`SELECT … FOR UPDATE` en una transacción interactiva; Prisma no tiene
   * `FOR UPDATE` en su API de consultas). `fn` recibe `null` si no existe o está borrado. Si `fn` lanza, se deshace todo.
   */
  async withLockedFlow<T>(id: string, fn: (locked: LockedFlow | null) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<LockedRow[]>`
          SELECT id, name_json AS "nameJson", draft, revision, latest_version AS "latestVersion",
                 unpublished_changes AS "unpublishedChanges", created_at AS "createdAt", updated_at AS "updatedAt"
          FROM flows
          WHERE id = ${id} AND deleted_at IS NULL
          FOR UPDATE`;
        const row = rows[0];
        return fn(row ? lockedFlow(tx, row) : null);
      },
      { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: TRANSACTION_TIMEOUT_MS },
    );
  }
}

function lockedFlow(tx: Prisma.TransactionClient, row: LockedRow): LockedFlow {
  return {
    row,
    lastVersion: async () =>
      row.latestVersion === null ? null : tx.flowVersion.findUnique({ where: { flowId_version: { flowId: row.id, version: row.latestVersion } } }),
    updateDraft: (data) =>
      tx.flow.update({
        where: { id: row.id },
        data: {
          draft: data.draft,
          nameJson: data.nameJson,
          revision: row.revision + 1,
          unpublishedChanges: data.unpublishedChanges,
          updatedAt: data.now,
        },
      }),
    insertVersion: async (data) => {
      const version = (row.latestVersion ?? 0) + 1;
      const created = await tx.flowVersion.create({
        data: { flowId: row.id, version, nameJson: data.nameJson, definition: data.definition, publishedAt: data.now },
      });
      await tx.flow.update({ where: { id: row.id }, data: { latestVersion: version, unpublishedChanges: false } });
      return created;
    },
    markDeleted: async (now) => {
      await tx.flow.update({ where: { id: row.id }, data: { deletedAt: now } });
    },
  };
}
