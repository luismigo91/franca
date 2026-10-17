/** Un marcador de variable `{{nombre}}` (con o sin espacios dentro). Con la bandera `g`: úsalo con `matchAll`, no con `test`. */
export const TEMPLATE_VAR = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

const MARKER = new RegExp(TEMPLATE_VAR.source);

/**
 * Indica si un texto contiene algún marcador `{{nombre}}`.
 *
 * @param text Texto a revisar.
 * @returns `true` si hay al menos un marcador válido (`{{1x}}` no lo es).
 */
export function hasMarker(text: string): boolean {
  return MARKER.test(text);
}
