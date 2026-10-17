import { resolve } from 'node:path';

// Vitest y Playwright se ejecutan siempre con `apps/web` como directorio de trabajo (`pnpm --filter @franca/web …`).
// Playwright compila a CommonJS (el paquete no es ESM), así que los ficheros que comparten no pueden usar `import.meta`.
export const WEB_ROOT = process.cwd();
export const REPO_ROOT = resolve(WEB_ROOT, '../..');
