import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { canvasModel } from '@/lib/editor/canvas-model';
import { nodeSize } from '@/lib/editor/canvas-geometry';
import { displayPositions } from '@/lib/editor/layout';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { addNode } from '@/lib/editor/node-templates';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const model = (flow: FlowDoc) => canvasModel(flow, displayPositions(flow));

describe('canvasModel', () => {
  it('Conexiones de captacion-leads: 12, las tres de pedir-tamano y onError de enviar-crm', () => {
    const { edges, nodes } = model(clone('captacion-leads'));
    expect(nodes).toHaveLength(11);
    expect(edges).toHaveLength(12);
    const from = (id: string) => edges.filter((edge) => edge.fromId === id).map((edge) => [edge.label, edge.toId]);
    expect(from('pedir-tamano')).toEqual([
      ['choices[pequena].next', 'marcar-pyme'],
      ['choices[mediana].next', 'marcar-pyme'],
      ['choices[grande].next', 'marcar-empresa'],
    ]);
    expect(from('enviar-crm')).toEqual([
      ['next', 'ruta-segmento'],
      ['onError', 'aviso-error'],
    ]);
    expect(edges.some((edge) => edge.broken)).toBe(false);
    expect(nodes.find((node) => node.id === 'bienvenida')!.isStart).toBe(true);
    expect(nodes.filter((node) => node.isStart)).toHaveLength(1);
  });

  it('una conexión a un nodo que no existe está rota y no tiene punto de llegada', () => {
    const flow = clone('captacion-leads');
    flow.nodes = (flow.nodes as Record<string, unknown>[]).filter((node) => node.id !== 'aviso-error');
    const broken = model(flow).edges.filter((edge) => edge.broken);
    expect(broken.map((edge) => [edge.fromId, edge.label, edge.toId, edge.to])).toEqual([['enviar-crm', 'onError', 'aviso-error', null]]);
  });

  it('el next de un llm sobre sí mismo es un lazo', () => {
    const flow = clone('faq-ia');
    (flow.nodes as Record<string, unknown>[])[1]!.next = 'asistente';
    const self = model(flow).edges.filter((edge) => edge.self);
    expect(self.map((edge) => [edge.fromId, edge.label])).toEqual([['asistente', 'next']]);
  });

  it('la clave de cada conexión es <índice del nodo>:<pointer> y es única', () => {
    const { edges } = model(clone('captacion-leads'));
    expect(edges[0]!.key).toBe('0:/next');
    expect(new Set(edges.map((edge) => edge.key)).size).toBe(edges.length);
  });

  it('la plantilla de regla añadida a una condición no da conexión para esa regla', () => {
    const flow = clone('captacion-leads');
    const ruta = (flow.nodes as { id: string; rules: unknown[] }[]).find((node) => node.id === 'ruta-segmento')!;
    ruta.rules.push({ when: { variable: '', op: 'eq' } });
    const { edges, nodes } = model(flow);
    expect(edges.filter((edge) => edge.fromId === 'ruta-segmento').map((edge) => edge.label).sort()).toEqual(['else', 'rules[0].next']);
    expect(nodes.find((node) => node.id === 'ruta-segmento')!.outputs.map((output) => output.key)).toEqual(['rules[0].next', 'rules[1].next', 'else']);
  });

  it('rules: [{next: 5}] no da ninguna conexión (mutante keepNonTextTargetIds)', () => {
    const flow = { start: 'c', nodes: [{ id: 'c', type: 'condition', rules: [{ next: 5 }] }] } as FlowDoc;
    expect(model(flow).edges).toEqual([]);
    const withElse = { start: 'c', nodes: [{ id: 'c', type: 'condition', rules: [{ when: { variable: '', op: 'eq' } }], else: 'c' }] } as FlowDoc;
    expect(model(withElse).edges.map((edge) => edge.label)).toEqual(['else']);
  });

  it('dos opciones con el mismo id dan salidas y conexiones con pointer distintos', () => {
    const flow = { start: 'i', nodes: [{ id: 'i', type: 'input', inputType: 'choice', choices: [{ id: 'a', label: '', next: 'f' }, { id: 'a', label: '', next: 'f' }] }, { id: 'f', type: 'end' }] } as FlowDoc;
    const { nodes, edges } = model(flow);
    expect(nodes[0]!.outputs.map((output) => output.pointer)).toEqual(['/choices/0/next', '/choices/1/next']);
    expect(edges.map((edge) => edge.pointer)).toEqual(['/choices/0/next', '/choices/1/next']);
    expect(new Set(edges.map((edge) => edge.key)).size).toBe(2);
  });

  it('una opción con id {} se etiqueta choices[0].next', () => {
    const flow = { start: 'i', nodes: [{ id: 'i', type: 'input', inputType: 'choice', choices: [{ id: {}, label: '', next: 'f' }] }, { id: 'f', type: 'end' }] } as FlowDoc;
    expect(model(flow).edges[0]!.label).toBe('choices[0].next');
    expect(model(flow).nodes[0]!.outputs[0]!.key).toBe('choices[0].next');
  });

  it('el modelo conserva el type y el title tal como están en el flujo (la vista los convierte con asText)', () => {
    const flow = { start: 'a', nodes: [{ id: 'a', type: {}, title: { es: 'x' } }, { id: 'b', type: 'end', title: 5 }, { id: 'c', type: 'end', title: null }] } as FlowDoc;
    const { nodes } = model(flow);
    expect(nodes.map((node) => [node.type, node.title])).toEqual([[{}, { es: 'x' }], ['end', 5], ['end', null]]);
  });

  it('las ocho plantillas de «Añadir nodo» y los nodos mal formados no lanzan', () => {
    let flow = clone('hola');
    for (const type of ['message', 'input', 'condition', 'set', 'http', 'llm', 'jump', 'end']) flow = addNode(flow, type, displayPositions(flow), { x: 0, y: 0 })!.flow;
    expect(() => model(flow)).not.toThrow();
    const malformed = { start: 'a', nodes: [{ id: 'a', type: 'condition' }, { id: 'b', type: 'condition', rules: [null] }, { id: 'c', type: 'input', choices: 'x' }, { id: 'd', type: 'input', choices: [null] }, { id: 'e', type: 'otro' }] } as FlowDoc;
    expect(() => model(malformed)).not.toThrow();
    expect(model(malformed).nodes).toHaveLength(5);
  });

  it('cada nodo mide lo que dice nodeSize y los límites lo contienen', () => {
    const flow = clone('captacion-leads');
    const { nodes, bounds } = model(flow);
    for (const node of nodes) {
      const size = nodeSize((flow.nodes as unknown[])[node.index]);
      expect([node.width, node.height]).toEqual([size.width, size.height]);
      expect(node.position.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(node.position.y + node.height).toBeLessThanOrEqual(bounds.minY + bounds.height);
    }
  });

  it('un flujo sin nodos tiene límites mínimos', () => {
    expect(canvasModel({ nodes: [] }, new Map()).bounds.width).toBeGreaterThan(0);
    expect(canvasModel({}, new Map()).nodes).toEqual([]);
  });
});
