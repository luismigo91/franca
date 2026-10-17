// Mutación dirigida de la web (D23): reutiliza el script del motor apuntándolo a este paquete.
// Uso: node scripts/mutate.mjs [--only id,id]   (código 1 si alguna mutación sobrevive o algo falla)
// Todos los mutantes deben morir con tests de Vitest (los E2E no entran: necesitarían un `next build` por mutante).
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineScript = resolve(root, '../../packages/engine/scripts/mutate.mjs');

// Los tests importan `@franca/spec` y `@franca/engine` desde su `dist/`: una compilación vieja falsearía la línea base.
for (const filter of ['@franca/spec', '@franca/engine']) {
  const build = spawnSync('pnpm', ['--filter', filter, 'build'], { stdio: 'inherit' });
  if (build.status !== 0) {
    console.error(`no se pudo compilar ${filter}; no se ejecuta la mutación`);
    process.exit(build.status ?? 1);
  }
}

Object.assign(process.env, {
  MUTATE_ROOT: root,
  MUTATE_MUTATIONS: join(root, 'tests', 'mutations.json'),
  MUTATE_TIMEOUT_MS: process.env.MUTATE_TIMEOUT_MS ?? '300000',
});
await import(engineScript);
