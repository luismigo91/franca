import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest y Playwright se ejecutan siempre con `apps/web` como directorio de trabajo (`pnpm --filter @franca/web …`).
// Playwright compila a CommonJS (el paquete no es ESM), así que los ficheros que comparten no pueden usar `import.meta`.
export const WEB_ROOT = process.cwd();
export const REPO_ROOT = resolve(WEB_ROOT, '../..');

// Falla pronto y con un mensaje claro si se ejecuta desde otro directorio.
let name: unknown;
try {
  name = (JSON.parse(readFileSync(resolve(WEB_ROOT, 'package.json'), 'utf8')) as { name?: unknown }).name;
} catch {
  name = undefined;
}
if (name !== '@franca/web') throw new Error('Los tests de la web se ejecutan desde apps/web (`pnpm --filter @franca/web test`): el directorio de trabajo no es el del paquete @franca/web.');
