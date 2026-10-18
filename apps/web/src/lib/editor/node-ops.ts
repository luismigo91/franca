import { exceedsFlowDepth } from '@franca/spec';
import type { Point } from '@/lib/editor/canvas-geometry';
import { DEPTH_ERROR, writeTarget } from '@/lib/editor/fields';
import { isRecord, removeIn, setIn, type EditResult, type FlowDoc } from '@/lib/editor/json-edit';
import { fixPositions } from '@/lib/editor/positions';
import { checkNodeId, indexOfNode, repointReferences } from '@/lib/editor/rename';

export const NOT_OBJECT_ERROR = 'El texto no es un objeto JSON.';
export const NO_ID_ERROR = 'El nodo necesita un id de texto.';

/**
 * «Borrar nodo»: quita el nodo de `nodes` sin tocar los saltos que apuntaban a él (quedan rotos y el validador los señala).
 *
 * @param flow El borrador.
 * @param id Nodo a borrar.
 */
export function deleteNode(flow: FlowDoc, id: string): FlowDoc {
  const index = indexOfNode(flow, id);
  return index === -1 ? flow : removeIn(flow, `/nodes/${index}`);
}

/**
 * «Editar como JSON»: sustituye el nodo por el objeto escrito. Un texto que no es un objeto JSON, o con el que el flujo
 * pasaría de 1000 niveles (se mide antes de serializar), no cambia nada. Un `id` distinto sigue las reglas de renombrar.
 *
 * @param flow El borrador.
 * @param id Nodo que se sustituye.
 * @param text El texto escrito.
 */
export function replaceNodeJson(flow: FlowDoc, id: string, text: string): EditResult {
  const index = indexOfNode(flow, id);
  if (index === -1) return { ok: false, error: 'El nodo ya no existe.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: NOT_OBJECT_ERROR };
  }
  if (!isRecord(parsed)) return { ok: false, error: NOT_OBJECT_ERROR };
  if (exceedsFlowDepth(setIn(flow, `/nodes/${index}`, parsed))) return { ok: false, error: DEPTH_ERROR };
  const node = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
  if (typeof node.id !== 'string') return { ok: false, error: NO_ID_ERROR };
  const problem = node.id === id ? null : checkNodeId(flow, id, node.id);
  if (problem !== null) return { ok: false, error: problem };
  const replaced = setIn(flow, `/nodes/${index}`, node);
  return { ok: true, flow: node.id === id ? replaced : repointReferences(replaced, id, node.id) };
}

/**
 * Cambia el destino de una salida de un nodo (`null` la quita), sin tocar las posiciones.
 *
 * @param flow El borrador.
 * @param nodeId Nodo de la salida.
 * @param pointer Puntero de la salida dentro del nodo.
 * @param destination Id del destino, o `null` («ninguno»).
 */
export function setTarget(flow: FlowDoc, nodeId: string, pointer: string, destination: string | null): EditResult {
  const index = indexOfNode(flow, nodeId);
  if (index === -1) return { ok: false, error: 'El nodo ya no existe.' };
  return writeTarget(`/nodes/${index}${pointer}`, destination)(flow, null);
}

/**
 * Conecta una salida, arrastrando o con el selector del inspector (también «ninguno»): fija las posiciones y cambia el
 * destino. Es **la** función de las dos vías, así que dan el mismo JSON.
 *
 * @param flow El borrador.
 * @param positions Posiciones con las que se pinta cada nodo.
 * @param nodeId Nodo de la salida.
 * @param pointer Puntero de la salida dentro del nodo.
 * @param destination Id del destino, o `null`.
 */
export function connectOutput(flow: FlowDoc, positions: ReadonlyMap<string, Point>, nodeId: string, pointer: string, destination: string | null): EditResult {
  return setTarget(fixPositions(flow, positions), nodeId, pointer, destination);
}

