import { asText } from '@/lib/editor/as-text';

/** Nombre en español de cada tipo de nodo. Es un `Map`: un `type` como `constructor` no encuentra nada (D10). */
export const NODE_TYPE_LABELS: ReadonlyMap<string, string> = new Map([
  ['message', 'Mensaje'],
  ['input', 'Pregunta'],
  ['condition', 'Condición'],
  ['set', 'Asignación'],
  ['http', 'Llamada HTTP'],
  ['llm', 'Paso con LLM'],
  ['jump', 'Salto'],
  ['end', 'Fin'],
]);

/** Los ocho tipos, en el orden de «Añadir nodo». */
export const NODE_TYPES: readonly string[] = [...NODE_TYPE_LABELS.keys()];

/**
 * Etiqueta de un tipo: la de uno de los ocho, o el valor escrito en el flujo (con `asText`).
 *
 * @param type El `type` de un nodo, de cualquier tipo.
 */
export function nodeTypeLabel(type: unknown): string {
  return (typeof type === 'string' ? NODE_TYPE_LABELS.get(type) : undefined) ?? asText(type);
}
