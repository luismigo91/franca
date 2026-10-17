import { defineConfig } from 'vitest/config';

// La configuración de `pnpm --filter @franca/api mutate` (D21): unit y e2e juntos, con el `globalSetup` de Postgres, porque
// los mutantes de la salida http se matan con tests de las dos clases. Necesita `DATABASE_URL`, como `test:e2e`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Todos los ficheros comparten una base y los escenarios cuentan totales: uno detrás de otro.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
