import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { asText } from '@/lib/editor/as-text';
import { describeCounts } from '@/lib/editor/issues-view';
import type { CanvasNode } from '@/lib/editor/canvas-model';
import { nodeTypeLabel } from '@/lib/editor/node-types';

export type DropState = 'allowed' | 'denied';

interface CanvasNodeViewProps {
  node: CanvasNode;
  selected: boolean;
  /** Problemas y avisos del nodo, o `undefined` si no tiene. */
  problems: { issues: number; warnings: number } | undefined;
  /** El validador recortó su lista: sin problemas listados no es lo mismo que sin problemas. */
  truncated: boolean;
  /** Esquina superior izquierda del mundo, para pasar de coordenadas del flujo a las del lienzo. */
  origin: { minX: number; minY: number };
  /** Desplazamiento mientras se arrastra (unidades del flujo). */
  offset: { x: number; y: number };
  /** Mientras se arrastra una salida: si se puede soltar aquí. */
  dropState: DropState | null;
  onNodePointerDown: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  onOutputPointerDown: (event: ReactPointerEvent<HTMLElement>, id: string, pointer: string) => void;
  onNodeKeyDown: (event: ReactKeyboardEvent<HTMLElement>, id: string) => void;
}

const DROP_TEXT: Record<DropState, string> = { allowed: 'Soltar aquí', denied: 'No se puede soltar aquí' };

/**
 * Un nodo del lienzo (D10): un `div` con rol de botón, enfocable, con su `id`, su tipo en español, su `title`, la marca
 * «Inicio», la de problemas con texto y una fila por salida. Las salidas no reciben el foco. Todo valor del flujo se pinta con
 * `asText` (nunca `[object Object]`) y la caja mide siempre lo que dice `nodeSize`, con los textos recortados.
 */
export function CanvasNodeView({ node, selected, problems, truncated, origin, offset, dropState, onNodePointerDown, onOutputPointerDown, onNodeKeyDown }: CanvasNodeViewProps) {
  const typeLabel = nodeTypeLabel(node.type);
  const counts = problems === undefined ? '' : describeCounts(problems.issues, problems.warnings);
  const name = `${node.id}, ${typeLabel}${node.isStart ? ', inicio' : ''}, ${counts === '' ? (truncated ? 'sin problemas conocidos' : 'sin problemas') : counts}`;
  const border = dropState === 'allowed' ? 'border-2 border-dashed border-foreground' : selected ? 'border-2 border-foreground' : 'border border-foreground/40';
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={name}
      data-node-id={node.id}
      data-drop={dropState ?? undefined}
      className={`absolute block touch-none select-none overflow-hidden rounded-md bg-background p-0 text-left text-foreground ${border} ${dropState === 'denied' ? 'opacity-50' : ''} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground`}
      style={{ left: node.position.x - origin.minX + offset.x, top: node.position.y - origin.minY + offset.y, width: node.width, height: node.height }}
      onPointerDown={(event) => onNodePointerDown(event, node.id)}
      onKeyDown={(event) => onNodeKeyDown(event, node.id)}
    >
      <span className="block h-16 px-2 pt-1 leading-tight">
        <span className="flex items-center justify-between gap-1 text-xs font-semibold">
          <span translate="no" className="truncate">{node.id}</span>
          {node.isStart && <span className="shrink-0 rounded border border-foreground/50 px-1 text-[10px] font-medium">Inicio</span>}
        </span>
        <span className="flex items-center justify-between gap-1 text-[11px] opacity-80">
          <span className="truncate">{typeLabel}</span>
          {counts !== '' && <span className="shrink-0 rounded border border-red-700 px-1 text-[10px] font-medium text-red-700 dark:border-red-400 dark:text-red-400">{counts}</span>}
        </span>
        <span className="block truncate text-[11px]">{dropState === null ? asText(node.title) : DROP_TEXT[dropState]}</span>
      </span>
      {node.outputs.map((output) => (
        <span key={`${node.index}:${output.pointer}`} className="flex h-6 items-center justify-between gap-1 pl-2 text-[11px]">
          <span className="truncate">{output.key}</span>
          {/* Zona de toque de 24 px (la altura de la fila) alrededor del punto visible. */}
          <span
            data-output={output.key}
            data-pointer={output.pointer}
            aria-hidden="true"
            className="grid size-6 shrink-0 cursor-crosshair place-items-center"
            onPointerDown={(event) => onOutputPointerDown(event, node.id, output.pointer)}
          >
            <span className="size-3 rounded-full border-2 border-foreground bg-background" />
          </span>
        </span>
      ))}
    </button>
  );
}
