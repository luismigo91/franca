// Candado de mutación: `mutate` reescribe ficheros de `src/` mientras corre (y deja una copia en
// `packages/*/.mutate-backup/`). Si en ese momento otro proceso compila (`pnpm build`) o ejecuta `pnpm check`
// (el Stop hook lo hace al terminar un turno), `dist/` queda compilado con un `src/` mutado y todo lo que
// depende de él da veredictos falsos. Mientras exista una copia de seguridad, no se compila ni se verifica.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packages = join(root, 'packages');
const running = existsSync(packages) ? readdirSync(packages).filter((name) => existsSync(join(packages, name, '.mutate-backup'))) : [];

if (running.length > 0) {
  console.error(`mutación en curso: espera a que termine \`mutate\` (copias en packages/${running.join(', packages/')}/.mutate-backup/)`);
  process.exit(1);
}
