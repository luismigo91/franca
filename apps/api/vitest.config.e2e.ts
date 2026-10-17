import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Crea una base propia, aplica las migraciones y la borra al terminar (necesita DATABASE_URL de un Postgres).
    globalSetup: ['./test/global-setup.ts'],
    // Todos los ficheros comparten una base y los escenarios cuentan totales: uno detrás de otro.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
