#!/usr/bin/env node
// El «Vitest» de la mutación de la API (D21): `scripts/mutate.mjs` del motor lo lanza como `vitest run <tests…>` y esto lo
// ejecuta con `vitest.config.mutate.ts` (unit y e2e juntos, con el `globalSetup` de Postgres).
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(join(root, 'node_modules/.bin/vitest'), [...process.argv.slice(2), '--config', 'vitest.config.mutate.ts'], { cwd: root, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on('close', (status, signal) => process.exit(signal ? 1 : (status ?? 1)));
