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

/** Opciones de `renderTemplate`. Sin ellas se comporta como la versión sin opciones. */
export interface RenderOptions {
  /** Longitud máxima del resultado; por defecto `MAX_RENDERED_LENGTH`. */
  maxLength?: number;
  /**
   * Transforma la forma textual de cada valor insertado (no el texto literal). Recibe lo que queda
   * de presupuesto; si lanza, el error se propaga.
   */
  insert?: (text: string, budget: number) => string;
}

/**
 * Sustituye en una sola pasada cada `{{nombre}}` por la forma textual de su valor; lo demás queda
 * literal y el texto insertado no se reexamina. Corta en cuanto la suma supera el límite, sin
 * construir la cadena completa.
 *
 * @param template Plantilla.
 * @param lookup Valor actual de una variable, o `undefined` si no tiene.
 * @param options Límite propio y transformación de los valores insertados.
 * @returns El texto renderizado.
 * @throws {ValueTooLargeError} Si el resultado superaría el límite (por defecto `MAX_RENDERED_LENGTH`).
 */
export function renderTemplate(
  template: string,
  lookup: (name: string) => VariableValue | undefined,
  options: RenderOptions = {},
): string {
  const max = options.maxLength ?? MAX_RENDERED_LENGTH;
  const parts: string[] = [];
  let length = 0;
  const push = (piece: string): void => {
    length += piece.length;
    if (length > max) throw new ValueTooLargeError();
    parts.push(piece);
  };
  let last = 0;
  for (const match of template.matchAll(TEMPLATE_VAR)) {
    push(template.slice(last, match.index));
    const text = textOf(lookup(match[1]!));
    push(options.insert ? options.insert(text, max - length) : text);
    last = match.index + match[0].length;
  }
  push(template.slice(last));
  return parts.join('');
}

/**
 * Longitud que tendría `renderTemplate(template, lookup)` sin construir el texto: suma las
 * longitudes y corta en cuanto superan `MAX_RENDERED_LENGTH`.
 *
 * @param template Plantilla.
 * @param lookup Valor actual de una variable, o `undefined` si no tiene.
 * @returns La longitud del texto renderizado, en unidades de código.
 * @throws {ValueTooLargeError} En el mismo punto en que lo lanzaría `renderTemplate`.
 */
export function measureTemplate(template: string, lookup: (name: string) => VariableValue | undefined): number {
  let length = 0;
  let last = 0;
  const add = (size: number): void => {
    length += size;
    if (length > MAX_RENDERED_LENGTH) throw new ValueTooLargeError();
  };
  for (const match of template.matchAll(TEMPLATE_VAR)) {
    add(match.index - last);
    add(textOf(lookup(match[1]!)).length);
    last = match.index + match[0].length;
  }
  add(template.length - last);
  return length;
}

/**
 * Nombres de las variables que cita una plantilla, en orden de aparición y con repeticiones, con
 * la misma gramática de marcadores que `renderTemplate`.
 *
 * @param template Plantilla.
 * @returns Los nombres citados.
 */
export function templateVariables(template: string): string[] {
  return [...template.matchAll(TEMPLATE_VAR)].map((match) => match[1]!);
}
