import { PrismaPg } from '@prisma/adapter-pg';
import { inject } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/** Cliente de Prisma sobre la base propia de esta ejecución de los e2e. Cierra con `$disconnect()`. */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: inject('databaseUrl') }), errorFormat: 'minimal' });
}

/** Vacía las tablas de la API (antes de cada test: todos los ficheros comparten la base). */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE flow_versions, flows`;
}

/**
 * Escribe un borrador directamente en la base, saltándose la API: lo que habría dejado un validador anterior.
 * No toca `revision`; úsalo sobre un flujo ya creado.
 */
export async function writeDraftDirectly(prisma: PrismaClient, id: string, draft: string): Promise<void> {
  await prisma.$executeRaw`UPDATE flows SET draft = ${draft} WHERE id = ${id}`;
}
