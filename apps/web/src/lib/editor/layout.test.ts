import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { NODE_WIDTH, nodeSize } from '@/lib/editor/canvas-geometry';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { autoLayout, displayPositions, validPosition } from '@/lib/editor/layout';
import { addNode } from '@/lib/editor/node-templates';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;

/** Cajas de todos los nodos con la posición con que se pintan. */
function boxes(flow: FlowDoc) {
  const positions = displayPositions(flow);
  return (flow.nodes as Record<string, unknown>[]).map((node) => ({ id: String(node.id), ...positions.get(String(node.id))!, ...nodeSize(node) }));
}

function overlapping(flow: FlowDoc): string[] {
  const all = boxes(flow);
  const found: string[] = [];
  all.forEach((a, i) =>
    all.slice(i + 1).forEach((b) => {
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) found.push(`${a.id}/${b.id}`);
    }),
  );
  return found;
}

describe('autoLayout', () => {
  it('es determinista, estable ante un cambio de texto y con enteros', () => {
    const flow = clone('faq-ia');
    expect([...autoLayout(flow)]).toEqual([...autoLayout(structuredClone(flow))]);
    const edited = structuredClone(flow);
    (edited as { name: string }).name = 'Otro nombre';
    expect([...autoLayout(edited)]).toEqual([...autoLayout(flow)]);
    for (const { x, y } of autoLayout(flow).values()) expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
  });

  it('ningún par de cajas se solapa en los ejemplos', () => {
    expect(overlapping(clone('faq-ia'))).toEqual([]);
    expect(overlapping(clone('captacion-leads'))).toEqual([]);
  });

  it('bienvenida de captacion-leads se queda en {0, 0} y es el origen', () => {
    const positions = displayPositions(clone('captacion-leads'));
    expect(positions.get('bienvenida')).toEqual({ x: 0, y: 0 });
    expect(positions.get('pedir-nombre')!.x).toBe(NODE_WIDTH + 96);
    expect(autoLayout(clone('captacion-leads')).has('bienvenida')).toBe(false);
  });

  it('start va en la capa 0 y cada salto, una capa a la derecha', () => {
    const positions = displayPositions(clone('faq-ia'));
    expect(positions.get('saludo')).toEqual({ x: 0, y: 0 });
    expect(positions.get('asistente')!.x).toBe(NODE_WIDTH + 96);
    expect(positions.get('comprobar')!.x).toBe(2 * (NODE_WIDTH + 96));
  });

  it('respeta las posiciones existentes y no se solapa con ellas (skipOverlapCheck)', () => {
    const flow = clone('faq-ia');
    // Un nodo fijo justo donde caería `asistente` y otro más abajo.
    (flow.nodes as Record<string, unknown>[])[2]!.position = { x: NODE_WIDTH + 96, y: 0 };
    (flow.nodes as Record<string, unknown>[])[3]!.position = { x: NODE_WIDTH + 96, y: 200 };
    expect(overlapping(flow)).toEqual([]);
    const positions = displayPositions(flow);
    expect(positions.get('comprobar')).toEqual({ x: NODE_WIDTH + 96, y: 0 });
    expect(positions.get('pedir-email')).toEqual({ x: NODE_WIDTH + 96, y: 200 });
    expect(positions.get('asistente')!.y).toBeGreaterThanOrEqual(200 + nodeSize((flow.nodes as unknown[])[3]).height + 40);
  });

  it('los nodos inalcanzables se colocan en capas siguientes, sin solaparse', () => {
    const flow = { start: 'a', nodes: [{ id: 'a', type: 'end' }, { id: 'huerfano', type: 'jump', target: 'otro' }, { id: 'otro', type: 'end' }, { id: 'suelto', type: 'end' }] } as FlowDoc;
    const positions = displayPositions(flow);
    expect(positions.get('a')!.x).toBe(0);
    expect(positions.get('huerfano')!.x).toBe(NODE_WIDTH + 96);
    expect(positions.get('otro')!.x).toBe(2 * (NODE_WIDTH + 96));
    expect(positions.get('suelto')!.x).toBe(3 * (NODE_WIDTH + 96));
    expect(overlapping(flow)).toEqual([]);
  });

  it('un flujo cuyo start no existe no lanza', () => {
    const flow = { start: 'nada', nodes: [{ id: 'a', type: 'end' }, { id: 'b', type: 'end' }] } as FlowDoc;
    expect(displayPositions(flow).size).toBe(2);
    expect(overlapping(flow)).toEqual([]);
  });

  it('una position inválida se pinta en la automática', () => {
    const flow = clone('hola');
    (flow.nodes as Record<string, unknown>[])[0]!.position = { x: 'a', y: 0 };
    expect(displayPositions(flow).get('fin')).toEqual({ x: 0, y: 0 });
    expect(autoLayout(flow).has('fin')).toBe(true);
  });

  it('posición válida solo con x e y finitos (infinitePosition)', () => {
    for (const bad of [{ x: Infinity, y: 0 }, { x: 0, y: -Infinity }, { x: 'a', y: 0 }, null, 5, 'x', [], { x: 1 }, { x: Number.NaN, y: 1 }]) {
      expect(validPosition(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(validPosition({ x: 1.5, y: -2 })).toEqual({ x: 1.5, y: -2 });
    // Y `1e400` de un JSON escrito a mano da Infinity al parsear.
    const parsed = JSON.parse('{"specVersion":"0.1","id":"h","name":"H","start":"fin","nodes":[{"id":"fin","type":"end","position":{"x":1e400,"y":0}}]}') as FlowDoc;
    expect(autoLayout(parsed).has('fin')).toBe(true);
  });

  it('con las ocho plantillas y nodos mal formados no lanza ni se solapa', () => {
    let flow = clone('hola');
    for (const type of ['message', 'input', 'condition', 'set', 'http', 'llm', 'jump', 'end']) flow = addNode(flow, type, displayPositions(flow), { x: 1000, y: 1000 })!.flow;
    expect(() => autoLayout(flow)).not.toThrow();
    const malformed = { start: 'a', nodes: [{ id: 'a', type: 'condition' }, { id: 'b', type: 'condition', rules: [null] }, { id: 'c', type: 'input', choices: 'x' }, { id: 'd', type: 'input', choices: [null] }, { id: 'e', type: 'otro' }] } as FlowDoc;
    expect(() => autoLayout(malformed)).not.toThrow();
    expect(overlapping(malformed)).toEqual([]);
  });

  it('un nodo con id constructor no choca con el prototipo', () => {
    const flow = { start: 'constructor', nodes: [{ id: 'constructor', type: 'jump', target: '__proto__' }, { id: '__proto__', type: 'end' }] } as FlowDoc;
    const positions = displayPositions(flow);
    expect(positions.get('constructor')).toEqual({ x: 0, y: 0 });
    expect(positions.get('__proto__')!.x).toBe(NODE_WIDTH + 96);
  });
});
