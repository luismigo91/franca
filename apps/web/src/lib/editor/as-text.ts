/**
 * Convierte un valor del flujo en texto para pintarlo (D10): un texto tal cual; `undefined`, `''`; y cualquier otro valor
 * (`{}`, `[]`, `5`, `null`, `true`) con `JSON.stringify`. Seguro porque el borrador nunca pasa de 1000 niveles.
 *
 * @param value Un valor cualquiera del flujo.
 */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return JSON.stringify(value) ?? '';
}
