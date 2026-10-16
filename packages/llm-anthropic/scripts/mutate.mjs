// Mutación dirigida del adaptador: reutiliza el script del motor (D25 de engine-llm) apuntándolo a este paquete.
// Uso: node scripts/mutate.mjs [--only id,id]
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Los tests del adaptador importan `@franca/engine` desde su `dist/`: una compilación vieja, o hecha con un
// `src/` mutado, falsearía la línea base y las mutaciones. Se recompila antes de empezar.
const build = spawnSync('pnpm', ['--filter', '@franca/engine', 'build'], { stdio: 'inherit' });
if (build.status !== 0) {
  console.error('no se pudo compilar @franca/engine; no se ejecuta la mutación');
  process.exit(build.status ?? 1);
}

process.env.MUTATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await import('../../engine/scripts/mutate.mjs');
