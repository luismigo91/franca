import { readFileSync } from 'node:fs';

const read = (name: string): any => JSON.parse(readFileSync(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));

/** Copia nueva de `captacion-leads` (los tests la mutan). */
export const leads = (): any => read('captacion-leads');

/** Copia nueva de `faq-ia`. */
export const faq = (): any => read('faq-ia');

/** Mide en milisegundos lo que tarda `fn` y devuelve también su resultado. */
export function timed<T>(fn: () => T): { result: T; ms: number } {
  const started = performance.now();
  const result = fn();
  return { result, ms: performance.now() - started };
}
