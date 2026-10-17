/**
 * Indica si una cabecera `If-Match` acepta la revisión actual de un borrador.
 *
 * Solo cuenta `*` (cualquier revisión) o una lista, separada por comas, con el ETag fuerte `"<revisión>"`. La
 * comparación es textual y no convierte a número: `W/"1"` (débil), `1` (sin comillas), `"01"` o el valor vacío no
 * coinciden.
 *
 * @param header Valor de la cabecera `If-Match`.
 * @param revision Revisión actual del borrador.
 * @returns `true` si la petición espera esta revisión.
 */
export function matchesIfMatch(header: string, revision: number): boolean {
  const value = header.trim();
  if (value === '*') return true;
  const current = `"${revision}"`;
  return value.split(',').some((tag) => tag.trim() === current);
}

/** El ETag fuerte de una revisión: `"3"`. */
export function etagOf(revision: number): string {
  return `"${revision}"`;
}
