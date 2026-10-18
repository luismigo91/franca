import { inputPoint, nodeSize, outputPoint, WORLD_MARGIN, type Point } from '@/lib/editor/canvas-geometry';
import { asText } from '@/lib/editor/as-text';
import { isRecord } from '@/lib/editor/json-edit';
import { nodeTypeLabel } from '@/lib/editor/node-types';
import { nodeTargets } from '@/lib/editor/node-targets';
import { nodeOutputs, type NodeOutput } from '@/lib/editor/outputs';

/** Un nodo tal como lo pinta el lienzo. */
export interface CanvasNode {
  /** Posición del nodo en `nodes` (la identidad para React junto con el puntero de sus salidas). */
  index: number;
  id: string;
  type: string;
  title: string;
  isStart: boolean;
  position: Point;
  width: number;
  height: number;
  outputs: NodeOutput[];
}

/** Una conexión: un salto de `targets`, rota si el destino no existe. */
export interface CanvasEdge {
  /** `<índice del nodo>:<pointer>`: único en el lienzo. */
  key: string;
  fromId: string;
  /** Nombre legible del campo. */
  label: string;
  pointer: string;
  toId: string;
  broken: boolean;
  /** El destino es el propio nodo (el `next` de un `llm`). */
  self: boolean;
  from: Point;
  /** `null` si la conexión está rota. */
  to: Point | null;
}

export interface CanvasBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface CanvasModel {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  bounds: CanvasBounds;
}

/**
 * El modelo del lienzo: nodos con su caja, una conexión por salto de `nodeTargets` y los límites del mundo. No lanza con
 * ningún flujo que dé `JSON.parse` (D25).
 *
 * @param flow El borrador.
 * @param positions Posición con la que se pinta cada nodo.
 */
export function canvasModel(flow: Record<string, unknown>, positions: ReadonlyMap<string, Point>): CanvasModel {
  const raw: unknown[] = Array.isArray(flow.nodes) ? (flow.nodes as unknown[]) : [];
  const nodes: CanvasNode[] = [];
  const byId = new Map<string, CanvasNode>();
  raw.forEach((node, index) => {
    if (!isRecord(node) || typeof node.id !== 'string') return;
    const size = nodeSize(node);
    const canvasNode: CanvasNode = {
      index,
      id: node.id,
      type: nodeTypeLabel(node.type),
      title: asText(node.title),
      isStart: node.id === flow.start,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      outputs: nodeOutputs(node),
    };
    nodes.push(canvasNode);
    if (!byId.has(node.id)) byId.set(node.id, canvasNode);
  });
  const edges: CanvasEdge[] = [];
  for (const source of nodes) {
    for (const target of nodeTargets(raw[source.index])) {
      const outputIndex = source.outputs.findIndex((output) => output.pointer === target.pointer);
      const destination = byId.get(target.id);
      const from = outputIndex === -1 ? { x: source.position.x + source.width, y: source.position.y + source.height / 2 } : outputPoint(source.position, outputIndex);
      edges.push({
        key: `${source.index}:${target.pointer}`,
        fromId: source.id,
        label: target.key,
        pointer: target.pointer,
        toId: target.id,
        broken: destination === undefined,
        self: destination === source,
        from,
        to: destination === undefined ? null : inputPoint(destination.position),
      });
    }
  }
  return { nodes, edges, bounds: boundsOf(nodes) };
}

function boundsOf(nodes: readonly CanvasNode[]): CanvasBounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, width: WORLD_MARGIN * 2, height: WORLD_MARGIN * 2 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.width);
    maxY = Math.max(maxY, node.position.y + node.height);
  }
  return { minX: minX - WORLD_MARGIN, minY: minY - WORLD_MARGIN, width: maxX - minX + WORLD_MARGIN * 2, height: maxY - minY + WORLD_MARGIN * 2 };
}
