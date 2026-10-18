import type { Point } from '@/lib/editor/canvas-geometry';
import { isRecord, setIn, type FlowDoc } from '@/lib/editor/json-edit';

const round = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) });

/**
 * Fija las posiciones que se ven: añade `position` (enteros) **al final** de cada nodo que no la tiene. Una `position`
 * escrita, aunque sea inválida, se conserva tal cual (se corrige moviendo el nodo).
 *
 * @param flow El flujo.
 * @param positions Posiciones con las que se pinta cada nodo.
 * @returns Un flujo nuevo; el mismo si no falta ninguna.
 */
export function fixPositions(flow: FlowDoc, positions: ReadonlyMap<string, Point>): FlowDoc {
  if (!Array.isArray(flow.nodes)) return flow;
  let changed = false;
  const nodes = (flow.nodes as unknown[]).map((node) => {
    if (!isRecord(node) || Object.hasOwn(node, 'position') || typeof node.id !== 'string') return node;
    const point = positions.get(node.id);
    if (point === undefined) return node;
    changed = true;
    return Object.fromEntries([...Object.entries(node), ['position', round(point)]]);
  });
  return changed ? Object.fromEntries(Object.entries(flow).map(([key, value]) => [key, key === 'nodes' ? nodes : value])) : flow;
}

/**
 * Mueve un nodo: primero fija las posiciones de todos y después escribe la del nodo, redondeada y en su sitio.
 *
 * @param flow El flujo.
 * @param id Nodo que se mueve.
 * @param dx Desplazamiento en x (en unidades del flujo).
 * @param dy Desplazamiento en y.
 * @param positions Posiciones con las que se pinta cada nodo.
 */
export function moveNode(flow: FlowDoc, id: string, dx: number, dy: number, positions: ReadonlyMap<string, Point>): FlowDoc {
  const base = positions.get(id);
  const fixed = fixPositions(flow, positions);
  if (base === undefined || !Array.isArray(fixed.nodes)) return fixed;
  const index = (fixed.nodes as unknown[]).findIndex((node) => isRecord(node) && node.id === id);
  if (index === -1) return fixed;
  return setIn(fixed, `/nodes/${index}/position`, round({ x: base.x + dx, y: base.y + dy }));
}
