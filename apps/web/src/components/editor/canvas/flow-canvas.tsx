'use client';

import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { CanvasEdges } from '@/components/editor/canvas/canvas-edges';
import { CanvasNodeView, type DropState } from '@/components/editor/canvas/canvas-node';
import { useCanvasDrag } from '@/components/editor/canvas/use-canvas-drag';
import { clampZoom, ZoomControls } from '@/components/editor/canvas/zoom-controls';
import { outputPoint, type Point } from '@/lib/editor/canvas-geometry';
import { canvasModel } from '@/lib/editor/canvas-model';
import { canDropOn } from '@/lib/editor/drop';
import type { FlowDoc } from '@/lib/editor/json-edit';

/** Lo que el editor puede pedirle al lienzo. */
export interface CanvasHandle {
  /** Centro de la zona visible, en coordenadas del flujo. */
  visibleCenter(): Point;
  scrollToNode(id: string): void;
  focusZone(): void;
}

interface FlowCanvasProps {
  flow: FlowDoc;
  positions: ReadonlyMap<string, Point>;
  selectedId: string | null;
  problems: ReadonlyMap<string, { issues: number; warnings: number }>;
  handleRef?: Ref<CanvasHandle>;
  onSelect: (id: string | null) => void;
  onMoveNode: (id: string, dx: number, dy: number) => void;
  onConnect: (sourceId: string, pointer: string, targetId: string | null, cancelled: boolean) => void;
}

/**
 * El lienzo (D9): una zona con desplazamiento nativo que contiene un mundo de tamaño `límites × zoom`, un SVG con las
 * conexiones y un `div` por nodo. Mientras se arrastra, el nodo se pinta desplazado sin tocar el flujo; al soltar, una sola
 * edición. Los límites del mundo quedan congelados durante el arrastre.
 */
export function FlowCanvas({ flow, positions, selectedId, problems, handleRef, onSelect, onMoveNode, onConnect }: FlowCanvasProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const base = useMemo(() => canvasModel(flow, positions), [flow, positions]);
  // El mundo se congela mientras dura el arrastre: `stable` son los últimos límites sin arrastre (se ajusta durante el render).
  const [stable, setStable] = useState(base.bounds);
  const originRef = useRef({ minX: base.bounds.minX, minY: base.bounds.minY });

  const outputOf = (nodeId: string, pointer: string): Point | null => {
    const node = base.nodes.find((candidate) => candidate.id === nodeId);
    const index = node?.outputs.findIndex((output) => output.pointer === pointer) ?? -1;
    return node === undefined || index === -1 ? null : outputPoint(node.position, index);
  };

  const { drag, onNodePointerDown, onOutputPointerDown, onNodeKeyDown } = useCanvasDrag({
    zoom,
    zoneRef,
    originRef,
    outputPoint: outputOf,
    onSelect: onSelect as (id: string) => void,
    onMoveEnd: onMoveNode,
    onConnectEnd: onConnect,
    onKeyMove: onMoveNode,
  });

  const dragging = drag !== null;
  if (!dragging && stable !== base.bounds) setStable(base.bounds);
  const bounds = dragging ? stable : base.bounds;
  // Si al soltar cambia el origen del mundo, la zona corrige su desplazamiento en la misma diferencia.
  useLayoutEffect(() => {
    if (dragging) return;
    const zone = zoneRef.current;
    const previous = originRef.current;
    if (zone !== null && (previous.minX !== bounds.minX || previous.minY !== bounds.minY)) {
      zone.scrollLeft += (previous.minX - bounds.minX) * zoom;
      zone.scrollTop += (previous.minY - bounds.minY) * zoom;
    }
    originRef.current = { minX: bounds.minX, minY: bounds.minY };
  }, [bounds, dragging, zoom]);

  // Lo que se pinta: el nodo arrastrado desplazado y las conexiones siguiéndolo.
  const shown = useMemo(() => {
    if (drag === null || drag.kind !== 'move') return base;
    const start = positions.get(drag.id);
    if (start === undefined) return base;
    const moved = new Map(positions);
    moved.set(drag.id, { x: start.x + drag.dx, y: start.y + drag.dy });
    return canvasModel(flow, moved);
  }, [base, drag, flow, positions]);

  useImperativeHandle(
    handleRef,
    () => ({
      visibleCenter() {
        const zone = zoneRef.current;
        const { minX, minY } = originRef.current;
        if (zone === null) return { x: minX, y: minY };
        return { x: (zone.scrollLeft + zone.clientWidth / 2) / zoom + minX, y: (zone.scrollTop + zone.clientHeight / 2) / zoom + minY };
      },
      scrollToNode(id) {
        const zone = zoneRef.current;
        const node = base.nodes.find((candidate) => candidate.id === id);
        if (zone === null || node === undefined) return;
        const { minX, minY } = originRef.current;
        zone.scrollTo({
          left: Math.max(0, (node.position.x - minX + node.width / 2) * zoom - zone.clientWidth / 2),
          top: Math.max(0, (node.position.y - minY + node.height / 2) * zoom - zone.clientHeight / 2),
        });
      },
      focusZone() {
        zoneRef.current?.focus();
      },
    }),
    [base.nodes, zoom],
  );

  const dropStateOf = (nodeId: string): DropState | null => {
    if (drag === null || drag.kind !== 'connect') return null;
    return canDropOn(flow, drag.sourceId, drag.pointer, nodeId) ? 'allowed' : 'denied';
  };

  return (
    <section aria-label="Lienzo del flujo" className="flex min-w-0 flex-col gap-2">
      <ZoomControls zoom={zoom} onChange={(next) => setZoom(clampZoom(next))} />
      <div
        ref={zoneRef}
        id="flow-canvas"
        tabIndex={0}
        role="group"
        aria-label="Lienzo del flujo"
        className="relative h-[60dvh] min-h-64 min-w-0 overflow-auto rounded-md border border-foreground/30 bg-foreground/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground lg:h-[calc(100dvh-16rem)]"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.world === 'true') onSelect(null);
        }}
      >
        <div data-world="true" className="relative" style={{ width: bounds.width * zoom, height: bounds.height * zoom }}>
          <div data-world="true" className="absolute left-0 top-0 origin-top-left" style={{ width: bounds.width, height: bounds.height, transform: `scale(${zoom})` }}>
            <CanvasEdges
              edges={shown.edges}
              bounds={bounds}
              selectedId={selectedId}
              provisional={drag !== null && drag.kind === 'connect' ? { from: drag.from, to: drag.to } : null}
            />
            {shown.nodes.map((node) => (
              <CanvasNodeView
                key={node.index}
                node={node}
                selected={node.id === selectedId}
                problems={problems.get(node.id)}
                origin={bounds}
                offset={{ x: 0, y: 0 }}
                dropState={dropStateOf(node.id)}
                onNodePointerDown={onNodePointerDown}
                onOutputPointerDown={onOutputPointerDown}
                onNodeKeyDown={onNodeKeyDown}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs opacity-70">
        Arrastra un nodo para moverlo (o usa las flechas con el nodo enfocado) y arrastra una salida hasta otro nodo para conectarla. Con el teclado, elige los saltos en el inspector.
      </p>
    </section>
  );
}

