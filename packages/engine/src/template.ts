import { MAX_RENDERED_LENGTH } from './constants.js';
import type { VariableValue } from './types.js';

/** Un texto renderizado supera `MAX_RENDERED_LENGTH`. La capturan los nodos que renderizan. */
export class ValueTooLargeError extends Error {
  constructor() {
    super('el texto renderizado supera el tamaño máximo');
    this.name = 'ValueTooLargeError';
  }
}

// Copia literal de TEMPLATE_VAR en packages/spec/src/validate.ts: misma gramática de marcadores
// que el validador. (FOLLOW-UP: exportarla desde @franca/spec.)
const TEMPLATE_VAR = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Forma textual de un valor: el string tal cual; un number con la serialización JSON; `"true"` o
 * `"false"`; JSON compacto para arrays y objetos; cadena vacía si no hay valor.
 *
 * @param value Valor de la variable, o `undefined` si no tiene.
 * @returns Su forma textual.
 */
export function textOf(value: VariableValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Sustituye en una sola pasada cada `{{nombre}}` por la forma textual de su valor; lo demás queda
 * literal y el texto insertado no se reexamina. Corta en cuanto la suma supera el límite, sin
 * construir la cadena completa.
 *
 * @param template Plantilla.
 * @param lookup Valor actual de una variable, o `undefined` si no tiene.
 * @returns El texto renderizado.
 * @throws {ValueTooLargeError} Si el resultado superaría `MAX_RENDERED_LENGTH` unidades de código.
 */
export function renderTemplate(template: string, lookup: (name: string) => VariableValue | undefined): string {
  const parts: string[] = [];
  let length = 0;
  const push = (piece: string): void => {
    length += piece.length;
    if (length > MAX_RENDERED_LENGTH) throw new ValueTooLargeError();
    parts.push(piece);
  };
  let last = 0;
  for (const match of template.matchAll(TEMPLATE_VAR)) {
    push(template.slice(last, match.index));
    push(textOf(lookup(match[1]!)));
    last = match.index + match[0].length;
  }
  push(template.slice(last));
  return parts.join('');
}
