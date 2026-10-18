import { GAP_X, GAP_Y, NODE_WIDTH, nodeSize, type Point } from '@/lib/editor/canvas-geometry';
import { isRecord } from '@/lib/editor/json-edit';
import { nodeTargets } from '@/lib/editor/node-targets';

/** Posición válida: un objeto con `x` e `y` números finitos (`1e400` da `Infinity`; `{x: "a"}` o `null` no valen). */
export function validPosition(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box, margin: number): boolean {
  return a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;
}

function nodesOf(flow: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(flow.nodes) ? (flow.nodes as unknown[]).filter(isRecord) : [];
}

/** Capa de cada nodo y su orden de descubrimiento: anchura desde `start`, y cada inalcanzado abre la capa siguiente. */
function layers(nodes: Record<string, unknown>[], start: unknown): { order: string[]; layerOf: Map<string, number> } {
  const byId = new Map<string, Record<string, unknown>>();
  for (const node of nodes) if (typeof node.id === 'string' && !byId.has(node.id)) byId.set(node.id, node);
  const layerOf = new Map<string, number>();
  const order: string[] = [];
  let highest = -1;
  const search = (first: string, layer: number) => {
    const queue: [string, number][] = [[first, layer]];
    layerOf.set(first, layer);
    order.push(first);
    for (let at = 0; at < queue.length; at++) {
      const [id, current] = queue[at]!;
      highest = Math.max(highest, current);
      for (const target of nodeTargets(byId.get(id))) {
        if (!byId.has(target.id) || layerOf.has(target.id)) continue;
        layerOf.set(target.id, current + 1);
        order.push(target.id);
        queue.push([target.id, current + 1]);
      }
    }
  };
  if (typeof start === 'string' && byId.has(start)) search(start, 0);
  for (const node of nodes) {
    if (typeof node.id === 'string' && !layerOf.has(node.id)) search(node.id, highest + 1);
  }
  return { order, layerOf };
}

/**
 * Diseño automático (D11): posición entera de cada nodo **sin** `position` válida. Capas por anchura desde `start`,
 * columnas de `ancho + 96`, filas en el orden de descubrimiento, sin solaparse con ningún nodo colocado ni con los que ya
 * tienen `position`. Determinista y lineal salvo las comprobaciones contra los nodos con posición.
 *
 * @param flow El flujo.
 * @returns Id → posición, solo de los nodos que no tenían una válida.
 */
export function autoLayout(flow: Record<string, unknown>): Map<string, Point> {
  const nodes = nodesOf(flow);
  const fixed: Box[] = [];
  const sizes = new Map<string, { width: number; height: number }>();
  const needs = new Set<string>();
  let origin: Point = { x: 0, y: 0 };
  for (const node of nodes) {
    if (typeof node.id !== 'string') continue;
    const size = nodeSize(node);
    sizes.set(node.id, size);
    const position = validPosition(node.position);
    if (position === null) needs.add(node.id);
    else fixed.push({ ...position, ...size });
    if (node.id === flow.start && position !== null) origin = { x: Math.round(position.x), y: Math.round(position.y) };
  }
  const { order, layerOf } = layers(nodes, flow.start);
  const cursor = new Map<number, number>();
  const placed = new Map<string, Point>();
  for (const id of order) {
    if (!needs.has(id)) continue;
    const layer = layerOf.get(id) ?? 0;
    const size = sizes.get(id)!;
    const x = origin.x + layer * (NODE_WIDTH + GAP_X);
    let y = cursor.get(layer) ?? origin.y;
    for (let again = true; again; ) {
      again = false;
      for (const box of fixed) {
        if (overlaps({ x, y, ...size }, box, GAP_Y)) {
          y = Math.max(y, Math.ceil(box.y + box.height + GAP_Y));
          again = true;
        }
      }
    }
    placed.set(id, { x, y });
    cursor.set(layer, y + size.height + GAP_Y);
  }
  return placed;
}

/**
 * Posición con la que se pinta cada nodo: su `position` si es válida, o la del diseño automático.
 *
 * @param flow El flujo.
 * @returns Id → posición de todos los nodos con `id` de texto.
 */
export function displayPositions(flow: Record<string, unknown>): Map<string, Point> {
  const automatic = autoLayout(flow);
  const all = new Map<string, Point>();
  for (const node of nodesOf(flow)) {
    if (typeof node.id !== 'string' || all.has(node.id)) continue;
    all.set(node.id, validPosition(node.position) ?? automatic.get(node.id) ?? { x: 0, y: 0 });
  }
  return all;
}
