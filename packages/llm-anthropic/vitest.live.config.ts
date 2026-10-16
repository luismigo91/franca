import { defineConfig } from 'vitest/config';

// El test en vivo no lo recoge `vitest run` (no termina en .test.ts): solo `pnpm test:live`.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.ts'],
    testTimeout: 120_000,
  },
});
