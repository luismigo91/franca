import { nodeOutputs } from '@/lib/editor/outputs';

// Constantes enteras del lienzo (D10). `nodeSize` las comparten el diseño automático y el CSS del nodo.
export const NODE_WIDTH = 208;
export const NODE_HEADER_HEIGHT = 64;
export const OUTPUT_HEIGHT = 24;
export const GAP_X = 96;
export const GAP_Y = 40;
export const WORLD_MARGIN = 80;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Caja que ocupa un nodo: ancho fijo y alto de la cabecera más una fila por salida.
 *
 * @param node Un nodo (de cualquier forma).
 */
export function nodeSize(node: unknown): Size {
  return { width: NODE_WIDTH, height: NODE_HEADER_HEIGHT + OUTPUT_HEIGHT * nodeOutputs(node).length };
}

/** Punto de salida (borde derecho) de la fila `index` de un nodo situado en `position`. */
export function outputPoint(position: Point, index: number): Point {
  return { x: position.x + NODE_WIDTH, y: position.y + NODE_HEADER_HEIGHT + OUTPUT_HEIGHT * index + OUTPUT_HEIGHT / 2 };
}

/** Punto de entrada (borde izquierdo, a media cabecera) de un nodo situado en `position`. */
export function inputPoint(position: Point): Point {
  return { x: position.x, y: position.y + NODE_HEADER_HEIGHT / 2 };
}
