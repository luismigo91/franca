// Mutación dirigida del adaptador: reutiliza el script del motor (D25 de engine-llm) apuntándolo a este paquete.
// Uso: node scripts/mutate.mjs [--only id,id]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.MUTATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await import('../../engine/scripts/mutate.mjs');
