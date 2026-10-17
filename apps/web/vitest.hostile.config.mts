import { defineConfig } from 'vitest/config';

// El hijo del test del proxy del entorno (D19): un proceso aparte, porque Node lee `NODE_USE_ENV_PROXY` al arrancar.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/hostile/**/*.hostile.ts'],
    testTimeout: 30_000,
  },
});
