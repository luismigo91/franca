import { defineConfig } from 'vitest/config';

// Unit, marcado, integración contra una API simulada en el proceso y guardas estáticas. Nada arranca Next, la API ni
// Postgres, y nada sale de loopback (D19).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
