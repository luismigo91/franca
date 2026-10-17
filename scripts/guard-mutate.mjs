// Candado de mutación: `mutate` reescribe ficheros de `src/` mientras corre (y deja una copia en
// `packages/*/.mutate-backup/` o `apps/*/.mutate-backup/`). Si en ese momento otro proceso compila (`pnpm build`) o ejecuta
// `pnpm check` (el Stop hook lo hace al terminar un turno), `dist/` queda compilado con un `src/` mutado y todo lo que
// depende de él da veredictos falsos. Mientras exista una copia de seguridad, no se compila ni se verifica.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspaces = ['packages', 'apps'];

/** Las carpetas `<espacio>/<nombre>` con una copia de seguridad de mutación. */
const running = workspaces.flatMap((space) => {
  const dir = join(root, space);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, '.mutate-backup')))
    .map((name) => `${space}/${name}`);
});

if (running.length > 0) {
  console.error(
    `mutación en curso: espera a que termine \`mutate\` (copias en ${running.map((path) => `${path}/.mutate-backup/`).join(', ')}). ` +
      'Si ya no se está ejecutando (se mató a medias), vuelve a lanzar `mutate` en ese paquete: restaura los ficheros y quita el candado.',
  );
  process.exit(1);
}
