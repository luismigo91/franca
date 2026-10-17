import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { ConversationsRepository, type InsertResult, type LockedConversation, type LockStep, type NewConversation } from '../../src/conversations/conversations.repository.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

/** Un `P1001` como el que Prisma 7.10.1 lanza contra un puerto cerrado (copiado de `database-errors.spec.ts`). */
export function databaseDown(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
    code: 'P1001',
    clientVersion: '7.10.1',
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'DatabaseNotReachable', host: '127.0.0.1', port: 59999 } } },
  });
}

/**
 * Repositorio de test: engancha esperas y fallos en los puntos donde las peticiones compiten, sin ganchos de test en
 * producción. Una barrera antes de `withLockedConversation` garantiza que las dos peticiones ya pasaron su validación y
 * compiten por las mismas filas.
 */
export class HookedConversationsRepository extends ConversationsRepository {
  /** Antes de abrir la transacción de un paso. */
  beforeStep: ((step: LockStep['step'], id: string) => Promise<void>) | undefined;
  /** Dentro de la transacción de un paso, con los bloqueos ya tomados. */
  onLocked: ((step: LockStep['step'], id: string) => Promise<void>) | undefined;
  /** Antes de la transacción que inserta una conversación nueva. */
  beforeInsert: (() => Promise<void>) | undefined;
  /** El próximo paso `apply` falla con un `P1001` (una sola vez). */
  failNextApply = false;

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  override async withLockedConversation<T>(id: string, fn: (locked: LockedConversation | null) => Promise<T>, options: LockStep): Promise<T> {
    await this.beforeStep?.(options.step, id);
    if (options.step === 'apply' && this.failNextApply) {
      this.failNextApply = false;
      throw databaseDown();
    }
    return super.withLockedConversation(
      id,
      async (locked) => {
        await this.onLocked?.(options.step, id);
        return fn(locked);
      },
      options,
    );
  }

  override async insertConversation(data: NewConversation): Promise<InsertResult> {
    await this.beforeInsert?.();
    return super.insertConversation(data);
  }

  /** Quita todos los ganchos. */
  clear(): void {
    this.beforeStep = undefined;
    this.onLocked = undefined;
    this.beforeInsert = undefined;
    this.failNextApply = false;
  }
}

/** Sustituye el repositorio por el de test; se recupera con `testApp.app.get(ConversationsRepository, { strict: false })`. */
export function withHookedRepository(builder: TestingModuleBuilder): TestingModuleBuilder {
  return builder.overrideProvider(ConversationsRepository).useFactory({
    factory: (prisma: PrismaService) => new HookedConversationsRepository(prisma),
    inject: [PrismaService],
  });
}

/** El repositorio de test de una app creada con `withHookedRepository`. */
export function hookedRepositoryOf(app: INestApplication): HookedConversationsRepository {
  return app.get(ConversationsRepository, { strict: false }) as HookedConversationsRepository;
}
