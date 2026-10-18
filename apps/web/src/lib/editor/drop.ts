import type { Point } from '@/lib/editor/canvas-geometry';
import { isRecord, type FlowDoc } from '@/lib/editor/json-edit';
import { connectOutput } from '@/lib/editor/node-ops';
import { indexOfNode } from '@/lib/editor/rename';

export type DropResult = { kind: 'none' } | { kind: 'reject'; reason: 'self' } | { kind: 'connect'; flow: FlowDoc };

export const SELF_JUMP_MESSAGE = 'Un nodo no puede saltar a sí mismo.';

/**
 * Indica si se puede soltar una salida sobre un nodo. Sobre sí mismo, solo el `next` de un `llm` (otra vuelta de la
 * conversación); el `onExhausted` de un `llm` no (un ciclo sin tope).
 *
 * @param flow El borrador.
 * @param sourceId Nodo de la salida.
 * @param outputPointer Puntero de la salida dentro del nodo.
 * @param targetId Nodo bajo el puntero.
 */
export function canDropOn(flow: FlowDoc, sourceId: string, outputPointer: string, targetId: string): boolean {
  if (targetId !== sourceId) return true;
  const index = indexOfNode(flow, sourceId);
  const node: unknown = Array.isArray(flow.nodes) ? (flow.nodes as unknown[])[index] : undefined;
  return isRecord(node) && node.type === 'llm' && outputPointer === '/next';
}

/**
 * Qué hace soltar una salida (D12). Cancelado o sin nodo debajo: nada. Sobre el propio nodo: se rechaza salvo el `next` de
 * un `llm`. Si no, conecta con `connectOutput`, la misma función que el selector del inspector.
 */
export function resolveDrop(input: {
  flow: FlowDoc;
  positions: ReadonlyMap<string, Point>;
  sourceId: string;
  outputPointer: string;
  targetId: string | null;
  cancelled: boolean;
}): DropResult {
  const { flow, positions, sourceId, outputPointer, targetId, cancelled } = input;
  if (cancelled || targetId === null) return { kind: 'none' };
  if (!canDropOn(flow, sourceId, outputPointer, targetId)) return { kind: 'reject', reason: 'self' };
  const result = connectOutput(flow, positions, sourceId, outputPointer, targetId);
  return result.ok ? { kind: 'connect', flow: result.flow } : { kind: 'none' };
}
