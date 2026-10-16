import type { InputNode } from '@franca/spec';

export type ParsedInput =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; option: number }
  | { kind: 'choices'; options: number[] };

function singleProperty(input: unknown): { key: string; owner: Record<string, unknown> } | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 1 || typeof keys[0] !== 'string') return null;
  return { key: keys[0], owner: input as Record<string, unknown> };
}

function readChoices(node: InputNode, value: unknown): ParsedInput | null {
  if (!Array.isArray(value)) return null;
  const known = optionIndexes(node);
  // Principio del palomar: más ids que opciones implica uno repetido o desconocido. Se rechaza sin recorrer.
  const length = value.length;
  if (length > known.size) return null;
  const options = new Set<number>();
  for (let i = 0; i < length; i++) {
    const id: unknown = value[i];
    const option = typeof id === 'string' ? known.get(id) : undefined;
    if (option === undefined || options.has(option)) return null;
    options.add(option);
  }
  return { kind: 'choices', options: [...options].sort((a, b) => a - b) };
}

const optionIndexes = (node: InputNode): Map<string, number> =>
  new Map((node.choices ?? []).map((choice, index) => [choice.id, index]));

/** @returns La propiedad que debe llevar la entrada para este nodo: `text`, `choice` o `choices`. */
export const expectedKey = (node: InputNode): 'text' | 'choice' | 'choices' =>
  node.inputType !== 'choice' ? 'text' : node.multiple === true ? 'choices' : 'choice';

/**
 * Lee la entrada del usuario con la forma que pide el nodo: un objeto plano con una sola propiedad
 * (`text`, `choice` o `choices`). No recorre ni copia estructuras del host: cada propiedad se lee una
 * vez y `choices` cuesta O(opciones del nodo), no O(longitud declarada).
 *
 * @param node Nodo input (forma JSON).
 * @param input Entrada sin tipar.
 * @returns La entrada leída, o `null` si no tiene la forma del nodo (→ `invalid_input`).
 */
export function readUserInput(node: InputNode, input: unknown): ParsedInput | null {
  const found = singleProperty(input);
  if (!found) return null;
  const expected = expectedKey(node);
  if (found.key !== expected) return null;
  const value = found.owner[found.key];
  if (expected === 'text') return typeof value === 'string' ? { kind: 'text', text: value } : null;
  if (expected === 'choices') return readChoices(node, value);
  const option = typeof value === 'string' ? optionIndexes(node).get(value) : undefined;
  return option === undefined ? null : { kind: 'choice', option };
}

/**
 * Lee el mensaje del usuario a un nodo `llm`: un objeto plano con la única propiedad `text` (string).
 * Mismas formas rechazadas que el `{text}` de `readUserInput`; no hace falta un nodo.
 *
 * @param input Entrada sin tipar.
 * @returns El texto sin recortar, o `null` si no tiene la forma (→ `invalid_input`).
 */
export function readTextInput(input: unknown): string | null {
  const found = singleProperty(input);
  if (!found || found.key !== 'text') return null;
  const value = found.owner.text;
  return typeof value === 'string' ? value : null;
}
