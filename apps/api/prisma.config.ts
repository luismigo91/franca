import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // No `env('DATABASE_URL')`: lanza si la variable falta, y `pnpm check`, el pre-push y el Stop hook ejecutan
    // `prisma generate` sin base de datos. `migrate` sin la variable falla con el error de Prisma.
    url: process.env.DATABASE_URL ?? '',
  },
});
