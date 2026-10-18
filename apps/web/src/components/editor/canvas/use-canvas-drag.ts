'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Point } from '@/lib/editor/canvas-geometry';

/** Un arrastre en curso: mover un nodo (desplazamiento en unidades del flujo) o conectar una salida. */
export type DragState =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'connect'; sourceId: string; pointer: string; from: Point; to: Point };

interface Options {
  zoom: number;
  zoneRef: RefObject<HTMLDivElement | null>;
  /** Esquina superior izquierda del mundo, congelada mientras dura el arrastre. */
  originRef: RefObject<{ minX: number; minY: number }>;
  /** Centro del punto de salida de un nodo, en coordenadas del flujo. */
  outputPoint: (nodeId: string, pointer: string) => Point | null;
  onSelect: (id: string) => void;
  onMoveEnd: (id: string, dx: number, dy: number) => void;
  /** `targetId` es el nodo bajo el puntero, o `null` (vacío o fuera del lienzo); `cancelled` si fue Escape o `pointercancel`. */
  onConnectEnd: (sourceId: string, pointer: string, targetId: string | null, cancelled: boolean) => void;
  onKeyMove: (id: string, dx: number, dy: number) => void;
}

const MOVE_THRESHOLD = 3;
const KEY_STEP = 10;

/**
 * Mover nodos y crear conexiones con Pointer Events (D12). Mientras dura un arrastre escucha `pointermove`, `pointerup`,
 * `pointercancel` y Escape en `window`; la decisión de qué hace soltar es de `resolveDrop`, fuera de aquí. Las salidas no
 * reciben el foco: la vía del teclado es el inspector, y los nodos se mueven con las flechas.
 */
export function useCanvasDrag(options: Options) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef(options);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    latest.current = options;
  });
  // Un arrastre en curso se cancela al desmontar el lienzo.
  useEffect(() => () => stop.current?.(), []);

  /** Del puntero (px del navegador) a coordenadas del flujo. */
  const toFlow = useCallback((clientX: number, clientY: number): Point => {
    const { zoom, zoneRef, originRef } = latest.current;
    const zone = zoneRef.current;
    const rect = zone?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: (clientX - left + (zone?.scrollLeft ?? 0)) / zoom + originRef.current.minX,
      y: (clientY - top + (zone?.scrollTop ?? 0)) / zoom + originRef.current.minY,
    };
  }, []);

  /** Registra los oyentes del arrastre en `window`; devuelve cómo quitarlos. */
  const track = useCallback((pointerId: number, handlers: { move: (event: PointerEvent) => void; end: (event: PointerEvent | null, cancelled: boolean) => void }) => {
    const onMove = (event: PointerEvent) => {
      if (event.pointerId === pointerId) handlers.move(event);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finish(event, false);
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finish(event, true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(null, true);
    };
    const remove = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      stop.current = null;
    };
    function finish(event: PointerEvent | null, cancelled: boolean) {
      remove();
      handlers.end(event, cancelled);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    stop.current = () => finish(null, true);
  }, []);

  const onNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      if (event.button !== 0 || stop.current !== null) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Sin captura el arrastre sigue funcionando: los eventos llegan a `window`.
      }
      track(event.pointerId, {
        move: (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          if (!moved && Math.hypot(dx, dy) <= MOVE_THRESHOLD) return;
          moved = true;
          const { zoom } = latest.current;
          setDrag({ kind: 'move', id, dx: dx / zoom, dy: dy / zoom });
        },
        end: (endEvent, cancelled) => {
          setDrag(null);
          if (cancelled) return;
          if (!moved || endEvent === null) {
            latest.current.onSelect(id);
            return;
          }
          const { zoom } = latest.current;
          latest.current.onMoveEnd(id, (endEvent.clientX - startX) / zoom, (endEvent.clientY - startY) / zoom);
        },
      });
    },
    [track],
  );

  const onOutputPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, sourceId: string, pointer: string) => {
      if (event.button !== 0 || stop.current !== null) return;
      event.stopPropagation();
      const from = latest.current.outputPoint(sourceId, pointer);
      if (from === null) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ídem.
      }
      setDrag({ kind: 'connect', sourceId, pointer, from, to: toFlow(event.clientX, event.clientY) });
      track(event.pointerId, {
        move: (moveEvent) => setDrag({ kind: 'connect', sourceId, pointer, from, to: toFlow(moveEvent.clientX, moveEvent.clientY) }),
        end: (endEvent, cancelled) => {
          setDrag(null);
          if (cancelled || endEvent === null) {
            latest.current.onConnectEnd(sourceId, pointer, null, true);
            return;
          }
          // La línea provisional y su <svg> no reciben eventos: elementFromPoint devuelve el nodo de debajo.
          const under = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
          const node = under?.closest('[data-node-id]') ?? null;
          const inside = node !== null && latest.current.zoneRef.current?.contains(node) === true;
          latest.current.onConnectEnd(sourceId, pointer, inside ? node.getAttribute('data-node-id') : null, false);
        },
      });
    },
    [track, toFlow],
  );

  const onNodeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>, id: string) => {
    if (event.target !== event.currentTarget) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] };
    const step = Object.hasOwn(arrows, event.key) ? arrows[event.key] : undefined;
    if (step !== undefined) {
      event.preventDefault();
      latest.current.onKeyMove(id, step[0], step[1]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      latest.current.onSelect(id);
    }
  }, []);

  return { drag, onNodePointerDown, onOutputPointerDown, onNodeKeyDown };
}
