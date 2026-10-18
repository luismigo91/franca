import { schema } from '@franca/spec';
import { isRecord, setIn, type EditResult, type FlowDoc } from '@/lib/editor/json-edit';
import { nodeTargets } from '@/lib/editor/node-targets';

const NODE_ID = new RegExp(schema.$defs.id.pattern);

export const ID_PATTERN_ERROR = 'El identificador empieza por una letra minúscula y solo admite minúsculas, números, - y _, hasta 64 caracteres.';
export const ID_TAKEN_ERROR = 'Ese id ya lo tiene otro nodo.';

/** Indica si un texto cumple el patrón de `id` de la spec (el mismo que usa la API para los flujos). */
export function isNodeId(value: unknown): value is string {
  return typeof value === 'string' && NODE_ID.test(value);
}

function nodeList(flow: FlowDoc): unknown[] {
  return Array.isArray(flow.nodes) ? (flow.nodes as unknown[]) : [];
}

/** Posición de un nodo en `nodes` por su `id`, o `-1`. */
export function indexOfNode(flow: FlowDoc, id: string): number {
  return nodeList(flow).findIndex((node) => isRecord(node) && node.id === id);
}

/** Actualiza `start` y todos los saltos que apuntan a `from` para que apunten a `to`. */
export function repointReferences(flow: FlowDoc, from: string, to: string): FlowDoc {
  let result = flow;
  if (result.start === from) result = setIn(result, '/start', to);
  nodeList(result).forEach((node, index) => {
    for (const target of nodeTargets(node)) {
      if (target.id === from) result = setIn(result, `/nodes/${index}${target.pointer}`, to);
    }
  });
  return result;
}

/**
 * Comprueba un id nuevo: el patrón de la spec y que no lo tenga otro nodo.
 *
 * @param flow El borrador.
 * @param current Id actual del nodo (se ignora a sí mismo).
 * @param next Id nuevo.
 * @returns El motivo, o `null` si vale.
 */
export function checkNodeId(flow: FlowDoc, current: string, next: string): string | null {
  if (!isNodeId(next)) return ID_PATTERN_ERROR;
  if (next !== current && indexOfNode(flow, next) !== -1) return ID_TAKEN_ERROR;
  return null;
}

/**
 * Renombra un nodo: cambia su `id` en su sitio y en `start` y en todos los saltos que apuntan a él. Un id fuera del
 * patrón o repetido no cambia nada. No toca los textos con `{{…}}`.
 *
 * @param flow El borrador.
 * @param from Id actual.
 * @param to Id nuevo.
 */
export function renameNode(flow: FlowDoc, from: string, to: string): EditResult {
  const index = indexOfNode(flow, from);
  if (index === -1) return { ok: false, error: 'El nodo ya no existe.' };
  if (from === to) return { ok: true, flow };
  const problem = checkNodeId(flow, from, to);
  if (problem !== null) return { ok: false, error: problem };
  return { ok: true, flow: repointReferences(setIn(flow, `/nodes/${index}/id`, to), from, to) };
}
