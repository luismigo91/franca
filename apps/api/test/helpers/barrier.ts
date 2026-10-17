import { FlowsRepository, type LockedFlow } from '../../src/flows/flows.repository.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

/**
 * Una barrera cíclica de `parties` participantes: `arrive()` espera hasta que han llegado todos y se rearma sola
 * para el grupo siguiente. Si faltan participantes, falla a los 10 s.
 */
export class Barrier {
  private waiting: (() => void)[] = [];

  constructor(private readonly parties: number) {}

  async arrive(): Promise<void> {
    const released = new Promise<void>((resolve) => this.waiting.push(resolve));
    if (this.waiting.length >= this.parties) {
      const group = this.waiting;
      this.waiting = [];
      group.forEach((release) => release());
    }
    const timer = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('la barrera no se completó: faltan peticiones')), 10_000).unref();
    });
    await Promise.race([released, timer]);
  }
}

/**
 * Repositorio de test: espera en una barrera antes de tomar el bloqueo. Garantiza que las dos peticiones ya pasaron
 * su validación y compiten por la misma fila; sin `FOR UPDATE` las dos leerían la misma revisión. No hay ganchos de
 * test en producción.
 */
export class BarrierFlowsRepository extends FlowsRepository {
  constructor(
    prisma: PrismaService,
    private readonly barrier: Barrier,
  ) {
    super(prisma);
  }

  override async withLockedFlow<T>(id: string, fn: (locked: LockedFlow | null) => Promise<T>): Promise<T> {
    await this.barrier.arrive();
    return super.withLockedFlow(id, fn);
  }
}
