import { Injectable } from '@nestjs/common';
import type { JsonValue } from '@franca/engine';
import { Prisma, type Conversation } from '../generated/prisma/client.js';
import { TRANSACTION_MAX_WAIT_MS, TRANSACTION_TIMEOUT_MS } from '../prisma/limits.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ConversationRow, EntryRow } from './conversation-resources.js';
import type { ConversationListQuery } from './conversation-query.js';

/** Una entrada de la transcripción que se va a escribir; el `seq` y el `at` los pone el repositorio bajo el bloqueo. */
export interface NewEntry {
  role: 'user' | 'flow';
  payload: string;
}

/** Lo que escribe un avance aplicado (o la creación), calculado por el servicio con el motor ya ejecutado. */
export interface AdvanceWrite {
  status: 'waiting' | 'ended' | 'failed';
  state: string | null;
  pendingInputJson: string | null;
  outcome: string | null;
  errorCode: string | null;
  errorNodeId: string | null;
  costUsd: number;
  costLimitReached: boolean;
  expiresAt: Date | null;
  entries: NewEntry[];
  /** `[nombre, JSON.stringify(valor)]` de los valores de contacto que el avance cambió. */
  contactUpserts: [string, string][];
  /** Nombres cuyo valor guardado se borra. */
  contactDeletes: string[];
}

export interface NewConversation {
  id: string;
  flowId: string;
  version: number;
  contactId: string | null;
  /** `epoch` del contacto que se leyó al empezar; solo con `contactId`. */
  contactEpoch: string | null;
  now: Date;
  write: AdvanceWrite;
}

export type InsertResult = { kind: 'created'; row: ConversationRow } | { kind: 'contact_gone' } | { kind: 'flow_gone' };

/** La fila de una conversación tomada con `FOR UPDATE`, con su estado y su longitud de transcripción. */
export type LockedRow = ConversationRow & Pick<Conversation, 'state' | 'transcriptLength'>;

/** Una conversación bloqueada dentro de una transacción: lo que se hace con ella se confirma o se deshace junto. */
export interface LockedConversation {
  readonly row: LockedRow;
  /** Toma la reclamación: pone el testigo y el instante. */
  claim(token: string, now: Date): Promise<void>;
  /** La definición de su versión publicada (las versiones nunca se borran, aunque el flujo sí). */
  readDefinition(): Promise<string>;
  /**
   * Aplica un avance: revisión + 1, `updatedAt` = `now`, entradas de la transcripción con los `seq` siguientes a
   * `transcriptLength`, cambios de contacto y la reclamación liberada, todo en el mismo `UPDATE`.
   */
  apply(write: AdvanceWrite, now: Date): Promise<ConversationRow>;
}

/** Qué paso del avance abre el bloqueo: reclamar solo bloquea la conversación; aplicar, antes, el contacto. */
export type LockStep = { step: 'claim' } | { step: 'apply'; contactId: string | null };

export interface Paging {
  limit: number;
  offset: number;
}

export interface TranscriptPage {
  total: number;
  items: EntryRow[];
}

/** Columnas de una conversación que lee un recurso (sin `state`). */
const ROW_SELECT = {
  id: true,
  flowId: true,
  version: true,
  contactId: true,
  status: true,
  revision: true,
  pendingInputJson: true,
  outcome: true,
  errorCode: true,
  errorNodeId: true,
  costUsd: true,
  costLimitReached: true,
  claimToken: true,
  claimedAt: true,
  createdAt: true,
  updatedAt: true,
  expiresAt: true,
} as const;

/** El único del módulo que habla con Prisma. Lee `flows` y `flow_versions` solo para leer. */
@Injectable()
export class ConversationsRepository {
  constructor(protected readonly prisma: PrismaService) {}

  // ---- Lector de versiones (de solo lectura, sin transacción) ----

  /** El flujo vivo (no borrado) con su última versión publicada, o `null`. */
  async findLiveFlow(flowId: string): Promise<{ latestVersion: number | null } | null> {
    return this.prisma.flow.findFirst({ where: { id: flowId, deletedAt: null }, select: { latestVersion: true } });
  }

  /** La definición de una versión publicada, aunque el flujo esté borrado; `null` si la versión no existe. */
  async findVersionDefinition(flowId: string, version: number): Promise<string | null> {
    const row = await this.prisma.flowVersion.findUnique({ where: { flowId_version: { flowId, version } }, select: { definition: true } });
    return row?.definition ?? null;
  }

  // ---- Contactos ----

  /**
   * Asegura la fila del contacto y devuelve su `epoch` en una sola sentencia: si ya existe conserva el suyo.
   *
   * @param contactId Identificador opaco del contacto.
   * @param candidateEpoch `epoch` nuevo (UUID) para un contacto que no existe.
   */
  async ensureContact(contactId: string, candidateEpoch: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ epoch: string }[]>`
      INSERT INTO contacts (contact_id, epoch) VALUES (${contactId}, ${candidateEpoch}::uuid)
      ON CONFLICT (contact_id) DO UPDATE SET epoch = contacts.epoch
      RETURNING epoch::text AS epoch`;
    return rows[0]!.epoch;
  }

  /** Todos los valores guardados de un contacto, por nombre (el motor ignora los que el flujo no declara). */
  async readContactValues(contactId: string): Promise<Map<string, JsonValue>> {
    const rows = await this.prisma.contactValue.findMany({ where: { contactId }, select: { name: true, valueJson: true }, orderBy: { name: 'asc' } });
    return new Map(rows.map((row) => [row.name, JSON.parse(row.valueJson) as JsonValue]));
  }

  // ---- Escrituras ----

  /**
   * Inserta una conversación nueva con su primer avance. Con contacto, bloquea primero su fila y comprueba que su
   * `epoch` sigue siendo el leído (si no, el contacto se borró durante la creación); después bloquea el flujo
   * `FOR SHARE` (espera a un borrado en curso) y comprueba que sigue vivo. Orden de bloqueos: contacto → flujo.
   */
  async insertConversation(data: NewConversation): Promise<InsertResult> {
    return this.prisma.$transaction(
      async (tx) => {
        if (data.contactId !== null) {
          const contacts = await tx.$queryRaw<{ epoch: string }[]>`SELECT epoch::text AS epoch FROM contacts WHERE contact_id = ${data.contactId} FOR UPDATE`;
          if (contacts[0]?.epoch !== data.contactEpoch) return { kind: 'contact_gone' } as const;
        }
        const flows = await tx.$queryRaw<{ deleted: boolean }[]>`SELECT (deleted_at IS NOT NULL) AS deleted FROM flows WHERE id = ${data.flowId} FOR SHARE`;
        if (flows[0] === undefined || flows[0].deleted) return { kind: 'flow_gone' } as const;
        const { write } = data;
        await tx.conversation.create({
          data: {
            id: data.id,
            flowId: data.flowId,
            version: data.version,
            contactId: data.contactId,
            status: write.status,
            revision: 1,
            state: write.state,
            pendingInputJson: write.pendingInputJson,
            outcome: write.outcome,
            errorCode: write.errorCode,
            errorNodeId: write.errorNodeId,
            costUsd: write.costUsd,
            costLimitReached: write.costLimitReached,
            transcriptLength: write.entries.length,
            claimToken: null,
            claimedAt: null,
            createdAt: data.now,
            updatedAt: data.now,
            expiresAt: write.expiresAt,
          },
          select: { id: true },
        });
        await writeEntries(tx, data.id, 0, write.entries, data.now);
        if (data.contactId !== null) await writeContactChanges(tx, data.contactId, write);
        const row = await tx.conversation.findUniqueOrThrow({ where: { id: data.id }, select: ROW_SELECT });
        return { kind: 'created', row } as const;
      },
      { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * Ejecuta `fn` con la conversación bloqueada (`SELECT … FOR UPDATE` en una transacción interactiva). `fn` recibe `null`
   * si no existe. En el paso `apply` con contacto, antes se bloquea la fila del contacto: orden fijo contacto →
   * conversación, el mismo que el del borrado de un contacto por la cascada. Si `fn` lanza, se deshace todo.
   */
  async withLockedConversation<T>(id: string, fn: (locked: LockedConversation | null) => Promise<T>, options: LockStep): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        if (options.step === 'apply' && options.contactId !== null) {
          await tx.$queryRaw`SELECT 1 AS locked FROM contacts WHERE contact_id = ${options.contactId} FOR UPDATE`;
        }
        const rows = await tx.$queryRaw<LockedRow[]>`
          SELECT id::text AS id, flow_id AS "flowId", version, contact_id AS "contactId", status::text AS status, revision,
                 state, pending_input_json AS "pendingInputJson", outcome, error_code AS "errorCode",
                 error_node_id AS "errorNodeId", cost_usd AS "costUsd", cost_limit_reached AS "costLimitReached",
                 transcript_length AS "transcriptLength", claim_token::text AS "claimToken", claimed_at AS "claimedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt", expires_at AS "expiresAt"
          FROM conversations
          WHERE id = ${id}::uuid
          FOR UPDATE`;
        const row = rows[0];
        return fn(row ? lockedConversation(tx, row) : null);
      },
      { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  /** Libera una reclamación si sigue siendo la propia (autocommit). */
  async releaseClaim(id: string, token: string): Promise<void> {
    await this.prisma.$executeRaw`UPDATE conversations SET claim_token = NULL, claimed_at = NULL WHERE id = ${id}::uuid AND claim_token = ${token}::uuid`;
  }

  /** Borra una conversación, su transcripción (cascada) y no los valores de su contacto. @returns Si existía. */
  async deleteConversation(id: string): Promise<boolean> {
    const { count } = await this.prisma.conversation.deleteMany({ where: { id } });
    return count > 0;
  }

  /** Borra un contacto: sus valores, sus conversaciones y sus transcripciones (cascada). Existan o no. */
  async deleteContact(contactId: string): Promise<void> {
    await this.prisma.contact.deleteMany({ where: { id: contactId } });
  }

  // ---- Lecturas ----

  /** El recurso de una conversación, sin su estado. */
  async findConversation(id: string): Promise<ConversationRow | null> {
    return this.prisma.conversation.findUnique({ where: { id }, select: ROW_SELECT });
  }

  /**
   * Página de conversaciones (sin `state`) y total, en orden `updatedAt` desc, `id` asc. Dos consultas simultáneas y sin
   * transacción, como `GET /flows`. `waiting` y `expired` se derivan de `expires_at` con el mismo `now`.
   */
  async listConversations(filter: Pick<ConversationListQuery, 'flowId' | 'status'>, page: Paging, now: Date): Promise<{ items: ConversationRow[]; total: number }> {
    const where: Prisma.ConversationWhereInput = {};
    if (filter.flowId !== undefined) where.flowId = filter.flowId;
    if (filter.status === 'waiting') Object.assign(where, { status: 'waiting', expiresAt: { gt: now } });
    else if (filter.status === 'expired') Object.assign(where, { status: 'waiting', expiresAt: { lte: now } });
    else if (filter.status !== undefined) where.status = filter.status;
    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({ where, select: ROW_SELECT, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: page.offset, take: page.limit }),
      this.prisma.conversation.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Una página de la transcripción y el total, en **una sola sentencia** (una instantánea): `total` e `items` son
   * coherentes aunque se aplique un avance a la vez. Los `seq` son consecutivos desde 1, así que la página es un rango; el
   * límite superior se calcula aquí y los dos extremos se enlazan como `bigint` (con `offset` 2147483647 la suma en SQL
   * desbordaría `int4`). `null` si la conversación no existe.
   */
  async listEntries(id: string, page: Paging): Promise<TranscriptPage | null> {
    const lower = BigInt(page.offset);
    const upper = BigInt(page.offset) + BigInt(page.limit);
    const rows = await this.prisma.$queryRaw<{ total: number; seq: number | null; at: Date | null; role: 'user' | 'flow' | null; payload: string | null }[]>`
      SELECT c.transcript_length AS total, e.seq AS seq, e.at AS at, e.role::text AS role, e.payload AS payload
      FROM conversations c
      LEFT JOIN conversation_entries e ON e.conversation_id = c.id AND e.seq > ${lower}::bigint AND e.seq <= ${upper}::bigint
      WHERE c.id = ${id}::uuid
      ORDER BY e.seq`;
    const first = rows[0];
    if (first === undefined) return null;
    const items = rows.flatMap((row) => (row.seq === null || row.at === null || row.role === null || row.payload === null ? [] : [{ seq: row.seq, at: row.at, role: row.role, payload: row.payload }]));
    return { total: first.total, items };
  }
}

function lockedConversation(tx: Prisma.TransactionClient, row: LockedRow): LockedConversation {
  return {
    row,
    claim: async (token, now) => {
      await tx.conversation.update({ where: { id: row.id }, data: { claimToken: token, claimedAt: now }, select: { id: true } });
    },
    readDefinition: async () => {
      const version = await tx.flowVersion.findUniqueOrThrow({ where: { flowId_version: { flowId: row.flowId, version: row.version } }, select: { definition: true } });
      return version.definition;
    },
    apply: async (write, now) => {
      const updated = await tx.conversation.update({
        where: { id: row.id },
        data: {
          status: write.status,
          revision: row.revision + 1,
          state: write.state,
          pendingInputJson: write.pendingInputJson,
          outcome: write.outcome,
          errorCode: write.errorCode,
          errorNodeId: write.errorNodeId,
          costUsd: write.costUsd,
          costLimitReached: write.costLimitReached,
          transcriptLength: row.transcriptLength + write.entries.length,
          claimToken: null,
          claimedAt: null,
          updatedAt: now,
          expiresAt: write.expiresAt,
        },
        select: ROW_SELECT,
      });
      await writeEntries(tx, row.id, row.transcriptLength, write.entries, now);
      if (row.contactId !== null) await writeContactChanges(tx, row.contactId, write);
      return updated;
    },
  };
}

async function writeEntries(tx: Prisma.TransactionClient, conversationId: string, after: number, entries: NewEntry[], at: Date): Promise<void> {
  if (entries.length === 0) return;
  await tx.conversationEntry.createMany({
    data: entries.map((entry, index) => ({ conversationId, seq: after + index + 1, at, role: entry.role, payload: entry.payload })),
  });
}

/**
 * Escribe los cambios de contacto en dos sentencias como mucho, sin importar cuántos sean: un flujo de 1 MiB admite
 * miles de variables de contacto y un `upsert` por fila mantendría el bloqueo del contacto segundos. Los nombres no se
 * repiten (salen de un objeto) y `unnest` conserva claves como `__proto__`.
 */
async function writeContactChanges(tx: Prisma.TransactionClient, contactId: string, write: Pick<AdvanceWrite, 'contactUpserts' | 'contactDeletes'>): Promise<void> {
  if (write.contactUpserts.length > 0) {
    const names = write.contactUpserts.map(([name]) => name);
    const values = write.contactUpserts.map(([, valueJson]) => valueJson);
    await tx.$executeRaw`
      INSERT INTO contact_values (contact_id, name, value_json)
      SELECT ${contactId}, t.name, t.value_json FROM unnest(${names}::text[], ${values}::text[]) AS t(name, value_json)
      ON CONFLICT (contact_id, name) DO UPDATE SET value_json = EXCLUDED.value_json`;
  }
  if (write.contactDeletes.length > 0) await tx.contactValue.deleteMany({ where: { contactId, name: { in: write.contactDeletes } } });
}
