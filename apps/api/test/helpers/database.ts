import { PrismaPg } from '@prisma/adapter-pg';
import { inject } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/** Cliente de Prisma sobre la base propia de esta ejecución de los e2e. Cierra con `$disconnect()`. */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: inject('databaseUrl') }), errorFormat: 'minimal' });
}
