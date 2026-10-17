/**
 * Indica si un valor JSON es un objeto (ni `null` ni array). Módulo interno: no se exporta desde `index.ts`.
 *
 * @param v Cualquier valor.
 * @returns `true` si es un objeto.
 */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
