// Mutación dirigida de la API (D21 de api-http-host): reutiliza el script del motor apuntándolo a este paquete.
// Uso: node scripts/mutate.mjs [--only id,id] [--defense-in-depth]
//   sin flags: los mutantes de test/mutations.json; ninguno debe sobrevivir (código 1 si alguno sobrevive o algo falla).
//   --defense-in-depth: los de test/mutations-defense-in-depth.json. Se espera que sobrevivan: se muestra la salida del
//   script del motor, que se lanza como proceso hijo, y se ignora su código de salida.
// Necesita `DATABASE_URL` (Postgres), como `test:e2e`.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineScript = resolve(root, '../../packages/engine/scripts/mutate.mjs');
const defenseInDepth = process.argv.includes('--defense-in-depth');

// Los tests importan `@franca/engine` desde su `dist/` y los de proceso, el `dist/` de la API: una compilación vieja, o hecha con
// un `src/` mutado, falsearía la línea base y las mutaciones. Se recompilan antes de empezar.
for (const filter of ['@franca/engine', '@franca/api']) {
  const build = spawnSync('pnpm', ['--filter', filter, 'build'], { stdio: 'inherit' });
  if (build.status !== 0) {
    console.error(`no se pudo compilar ${filter}; no se ejecuta la mutación`);
    process.exit(build.status ?? 1);
  }
}

const environment = {
  ...process.env,
  MUTATE_ROOT: root,
  MUTATE_MUTATIONS: join(root, 'test', defenseInDepth ? 'mutations-defense-in-depth.json' : 'mutations.json'),
  MUTATE_VITEST: join(root, 'scripts/vitest-mutate.mjs'),
  // La línea base incluye la conformidad completa y los procesos hijos.
  MUTATE_TIMEOUT_MS: process.env.MUTATE_TIMEOUT_MS ?? '600000',
};

if (defenseInDepth) {
  const args = process.argv.slice(2).filter((argument) => argument !== '--defense-in-depth');
  const run = spawnSync(process.execPath, [engineScript, ...args], { stdio: 'inherit', env: environment });
  console.log(`\nDefensa en profundidad: el script del motor terminó con el código ${run.status}; se espera que sobrevivan y no bloquea.`);
} else {
  Object.assign(process.env, environment);
  await import(engineScript);
}
