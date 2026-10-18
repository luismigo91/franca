import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { displayPositions } from '@/lib/editor/layout';
import { fixPositions, moveNode } from '@/lib/editor/positions';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const nodeOf = (flow: FlowDoc, id: string) => (flow.nodes as Record<string, unknown>[]).find((node) => node.id === id)!;

describe('fixPositions', () => {
  it('añade position (enteros) al final de cada nodo que no la tiene', () => {
    const flow = clone('faq-ia');
    const fixed = fixPositions(flow, displayPositions(flow));
    for (const node of fixed.nodes as Record<string, unknown>[]) {
      expect(Object.keys(node).at(-1)).toBe('position');
      const { x, y } = node.position as { x: number; y: number };
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    }
    expect(nodeOf(fixed, 'saludo').position).toEqual({ x: 0, y: 0 });
  });

  it('redondea posiciones con decimales y no toca las existentes', () => {
    const flow = clone('captacion-leads');
    const positions = new Map(displayPositions(flow));
    positions.set('pedir-nombre', { x: 304.6, y: 0.4 });
    const fixed = fixPositions(flow, positions);
    expect(nodeOf(fixed, 'pedir-nombre').position).toEqual({ x: 305, y: 0 });
    expect(nodeOf(fixed, 'bienvenida').position).toEqual({ x: 0, y: 0 });
  });

  it('sin nodos que fijar devuelve el mismo flujo', () => {
    const flow = clone('captacion-leads');
    const all = fixPositions(flow, displayPositions(flow));
    expect(fixPositions(all, displayPositions(all))).toBe(all);
  });

  it('conserva tal cual una position inválida (la señala el validador)', () => {
    const flow = clone('faq-ia');
    (flow.nodes as Record<string, unknown>[])[0]!.position = { x: 'a', y: 0 };
    const fixed = fixPositions(flow, displayPositions(flow));
    expect(nodeOf(fixed, 'saludo').position).toEqual({ x: 'a', y: 0 });
    expect(nodeOf(fixed, 'asistente').position).toBeDefined();
  });
});

describe('moveNode', () => {
  it('Mover un nodo guarda su posición: todas fijas, bienvenida en {0, 0}, pedir-nombre 20 unidades a la derecha', () => {
    const flow = clone('captacion-leads');
    const positions = displayPositions(flow);
    const painted = positions.get('pedir-nombre')!;
    const moved = moveNode(flow, 'pedir-nombre', 20, 0, positions);
    for (const node of moved.nodes as Record<string, unknown>[]) {
      const { x, y } = node.position as { x: number; y: number };
      expect(Number.isInteger(x) && Number.isInteger(y), String(node.id)).toBe(true);
    }
    expect(nodeOf(moved, 'bienvenida').position).toEqual({ x: 0, y: 0 });
    expect(nodeOf(moved, 'pedir-nombre').position).toEqual({ x: painted.x + 20, y: painted.y });
    expect(nodeOf(moved, 'pedir-nombre').position).toEqual({ x: 324, y: 0 });
    // El resto de nodos se queda donde se veía.
    expect(nodeOf(moved, 'pedir-email').position).toEqual(positions.get('pedir-email'));
  });

  it('redondea el desplazamiento y escribe la posición en su sitio', () => {
    const flow = clone('captacion-leads');
    (flow.nodes as Record<string, unknown>[])[1]!.position = { x: 10, y: 10 };
    const moved = moveNode(flow, 'pedir-nombre', 0.4, 20.6, displayPositions(flow));
    expect(nodeOf(moved, 'pedir-nombre').position).toEqual({ x: 10, y: 31 });
    expect(Object.keys(nodeOf(moved, 'pedir-nombre'))).toEqual(Object.keys(nodeOf(flow, 'pedir-nombre')));
  });

  it('una position inválida se sustituye al mover ese nodo', () => {
    const flow = clone('hola');
    (flow.nodes as Record<string, unknown>[])[0]!.position = { x: 'a', y: 0 };
    expect(nodeOf(moveNode(flow, 'fin', 10, 0, displayPositions(flow)), 'fin').position).toEqual({ x: 10, y: 0 });
  });

  it('un nodo que no existe solo fija las posiciones', () => {
    const flow = clone('hola');
    const moved = moveNode(flow, 'nada', 10, 0, displayPositions(flow));
    expect(nodeOf(moved, 'fin').position).toEqual({ x: 0, y: 0 });
  });
});
