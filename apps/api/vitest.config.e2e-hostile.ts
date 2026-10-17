import { defineConfig } from 'vitest/config';

// La configuración del proceso hijo de `test/http-host-environment.e2e-spec.ts` (D19): un Vitest que **nace** con las variables
// de proxy del entorno. Sin `globalSetup`: la base ya está creada y migrada por el padre, que pasa su cadena en `DATABASE_URL`.
// Solo ve `test/**/*.e2e-hostile.ts`, así que la ejecución normal de los e2e no lo recoge.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Los e2e hostiles solo corren como hijo de los e2e, con la base del padre en DATABASE_URL.');
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-hostile.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    provide: { databaseUrl },
  },
});
