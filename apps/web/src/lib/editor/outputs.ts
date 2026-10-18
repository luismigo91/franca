import { isRecord } from '@/lib/editor/json-edit';

/** Una salida de un nodo: un campo que guarda el `id` del destino (D10). */
export interface NodeOutput {
  /** Nombre legible del campo (solo etiqueta). */
  key: string;
  /** Puntero del campo dentro del nodo: es la identidad de la salida (dos opciones pueden repetir `id`). */
  pointer: string;
  /** Destino actual, o `null` si no tiene (o no es un texto). */
  id: string | null;
}

const target = (node: Record<string, unknown>, key: string): NodeOutput => ({
  key,
  pointer: `/${key}`,
  id: typeof node[key] === 'string' ? node[key] : null,
});

function choiceOutputs(node: Record<string, unknown>): NodeOutput[] {
  if (!Array.isArray(node.choices)) return [];
  const out: NodeOutput[] = [];
  node.choices.forEach((choice: unknown, index) => {
    if (!isRecord(choice)) return;
    const label = typeof choice.id === 'string' ? choice.id : index;
    out.push({ key: `choices[${label}].next`, pointer: `/choices/${index}/next`, id: typeof choice.next === 'string' ? choice.next : null });
  });
  return out;
}

function ruleOutputs(node: Record<string, unknown>): NodeOutput[] {
  if (!Array.isArray(node.rules)) return [];
  const out: NodeOutput[] = [];
  node.rules.forEach((rule: unknown, index) => {
    if (!isRecord(rule)) return;
    out.push({ key: `rules[${index}].next`, pointer: `/rules/${index}/next`, id: typeof rule.next === 'string' ? rule.next : null });
  });
  return out;
}

/**
 * Las salidas de un nodo: una por cada salto que usa el motor según su tipo (`resumeInput` solo mira `choices[].next` en
 * la selección única y el `next` del nodo en la múltiple). Defensiva: un nodo de forma inválida da las que se pueden leer.
 *
 * @param node Un nodo (de cualquier forma).
 */
export function nodeOutputs(node: unknown): NodeOutput[] {
  if (!isRecord(node)) return [];
  switch (node.type) {
    case 'message':
    case 'set':
      return [target(node, 'next')];
    case 'input':
      return node.inputType === 'choice' && node.multiple !== true ? choiceOutputs(node) : [target(node, 'next')];
    case 'condition':
      return [...ruleOutputs(node), target(node, 'else')];
    case 'http':
      return [target(node, 'next'), target(node, 'onError')];
    case 'llm':
      return [target(node, 'next'), target(node, 'onExhausted')];
    case 'jump':
      return [target(node, 'target')];
    default:
      return [];
  }
}
