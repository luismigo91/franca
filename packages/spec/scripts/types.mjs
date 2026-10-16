// Genera src/types.ts a partir de flow.schema.json.
// Uso: node scripts/types.mjs (escribe el fichero). El test de tipos reutiliza renderTypes().
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const root = new URL('..', import.meta.url);
export const TYPES_PATH = fileURLToPath(new URL('src/types.ts', root));

export function renderTypes() {
  const schema = JSON.parse(readFileSync(new URL('flow.schema.json', root), 'utf8'));
  return compile({ ...schema, title: 'Flow' }, 'Flow', {
    additionalProperties: false,
    unreachableDefinitions: true,
    ignoreMinAndMaxItems: true,
    bannerComment:
      '/* Generado desde flow.schema.json con `pnpm generate`. No editar a mano. */',
    style: { singleQuote: true },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(TYPES_PATH, await renderTypes());
}
