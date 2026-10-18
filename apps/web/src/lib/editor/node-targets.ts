import { targets, type Node } from '@franca/spec';
import { isRecord } from '@/lib/editor/json-edit';

/** Un salto de un nodo: lo mismo que `Target` de `@franca/spec`, pero solo con destinos de texto. */
export interface NodeTarget {
  /** Nombre legible del campo: `next`, `rules[0].next`, `choices[grande].next` (o `choices[0].next` sin `id` de texto). */
  key: string;
  /** El campo como JSON Pointer relativo al nodo. */
  pointer: string;
  /** Id del nodo destino. */
  id: string;
}

const PLAIN_KEYS = ['next', 'else', 'onError', 'onExhausted', 'target'] as const;

/** La forma mínima que `targets` recorre sin protección (revisión 2, B1). */
function hasMinimalShape(node: Record<string, unknown>): boolean {
  if (node.type === 'condition') return Array.isArray(node.rules) && node.rules.every(isRecord);
  if (node.type === 'input') return node.choices === undefined || (Array.isArray(node.choices) && node.choices.every(isRecord));
  return true;
}

function choiceKey(node: Record<string, unknown>, index: number): string {
  const choice = Array.isArray(node.choices) ? (node.choices[index] as unknown) : undefined;
  const id = isRecord(choice) ? choice.id : undefined;
  return `choices[${typeof id === 'string' ? id : index}].next`;
}

/** Los saltos que se pueden leer sin lanzar de un nodo que no tiene la forma mínima. */
function readableTargets(node: Record<string, unknown>): NodeTarget[] {
  const out: NodeTarget[] = [];
  for (const key of PLAIN_KEYS) {
    if (typeof node[key] === 'string') out.push({ key, pointer: `/${key}`, id: node[key] });
  }
  if (node.type === 'condition' && Array.isArray(node.rules)) {
    node.rules.forEach((rule: unknown, index) => {
      if (isRecord(rule) && typeof rule.next === 'string') out.push({ key: `rules[${index}].next`, pointer: `/rules/${index}/next`, id: rule.next });
    });
  }
  if (node.type === 'input' && Array.isArray(node.choices)) {
    node.choices.forEach((choice: unknown, index) => {
      if (isRecord(choice) && typeof choice.next === 'string') out.push({ key: choiceKey(node, index), pointer: `/choices/${index}/next`, id: choice.next });
    });
  }
  return out;
}

/**
 * Los saltos de un nodo cualquiera, sin lanzar nunca. Es la única puerta del editor a `targets` de `@franca/spec`, que
 * lanza `TypeError` con un nodo de forma inválida (una condición sin `rules`, `choices` que no es una lista de objetos):
 * «Añadir nodo» y «Editar como JSON» los producen. En los dos caminos solo da saltos con `id` de texto, y la clave de una
 * opción sin `id` de texto usa su índice.
 *
 * @param node Un nodo (de cualquier forma).
 * @returns Los saltos, en el orden de `targets`.
 */
export function nodeTargets(node: unknown): NodeTarget[] {
  if (!isRecord(node)) return [];
  if (!hasMinimalShape(node)) return readableTargets(node);
  const found = targets(node as unknown as Node);
  return found
    .filter((target) => typeof target.id === 'string')
    .map((target) => {
      const choice = /^\/choices\/(\d+)\/next$/.exec(target.pointer);
      return choice ? { ...target, key: choiceKey(node, Number(choice[1])) } : target;
    });
}
