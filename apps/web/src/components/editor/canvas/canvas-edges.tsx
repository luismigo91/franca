import { NODE_HEADER_HEIGHT } from '@/lib/editor/canvas-geometry';
import type { CanvasBounds, CanvasEdge } from '@/lib/editor/canvas-model';

/** Curva de una conexión: de la salida al borde izquierdo del destino; un lazo por encima si salta al propio nodo. */
export function edgePath(edge: CanvasEdge): string {
  const { from } = edge;
  if (edge.to === null) return `M ${from.x} ${from.y} L ${from.x + 36} ${from.y}`;
  const to = edge.to;
  if (edge.self) {
    const top = to.y - NODE_HEADER_HEIGHT / 2 - 28;
    return `M ${from.x} ${from.y} C ${from.x + 56} ${from.y} ${from.x + 56} ${top} ${(from.x + to.x) / 2} ${top} C ${to.x - 56} ${top} ${to.x - 56} ${to.y} ${to.x} ${to.y}`;
  }
  const reach = Math.max(48, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y} ${to.x - reach} ${to.y} ${to.x} ${to.y}`;
}

/**
 * Las conexiones del lienzo, en un `<svg aria-hidden>` que no recibe eventos de puntero. Una conexión rota es discontinua y
 * acaba en una marca con texto: «<id> no existe».
 */
export function CanvasEdges({
  edges,
  bounds,
  selectedId,
  provisional,
}: {
  edges: readonly CanvasEdge[];
  bounds: CanvasBounds;
  selectedId: string | null;
  /** Línea del arrastre en curso, en coordenadas del flujo. */
  provisional: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 overflow-visible text-foreground"
      width={bounds.width}
      height={bounds.height}
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
    >
      <defs>
        <marker id="edge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {edges.map((edge) => (
        <g key={edge.key} data-edge-from={edge.fromId} data-edge-key={edge.label} data-edge-pointer={edge.pointer} data-edge-to={edge.toId} data-broken={edge.broken ? 'true' : undefined}>
          <path
            d={edgePath(edge)}
            fill="none"
            stroke="currentColor"
            strokeWidth={selectedId === edge.fromId ? 2.5 : 1.5}
            strokeDasharray={edge.broken ? '5 4' : undefined}
            className={edge.broken ? 'text-red-700 dark:text-red-400' : undefined}
            markerEnd={edge.broken ? undefined : 'url(#edge-arrow)'}
          />
          {edge.broken && (
            <text x={edge.from.x + 40} y={edge.from.y + 4} fontSize="11" fill="currentColor" className="text-red-700 dark:text-red-400">
              ✕ {edge.toId} no existe
            </text>
          )}
        </g>
      ))}
      {provisional !== null && (
        <path d={`M ${provisional.from.x} ${provisional.from.y} L ${provisional.to.x} ${provisional.to.y}`} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="4 3" />
      )}
    </svg>
  );
}
