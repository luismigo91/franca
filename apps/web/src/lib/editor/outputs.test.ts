import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { addNode } from '@/lib/editor/node-templates';
import { nodeOutputs } from '@/lib/editor/outputs';
import { displayPositions } from '@/lib/editor/layout';

const nodesOf = (name: 'captacion-leads' | 'faq-ia') => (FLOWS[name] as { nodes: Record<string, unknown>[] }).nodes;
const keys = (node: unknown) => nodeOutputs(node).map((output) => output.key);

describe('nodeOutputs', () => {
  it('Salidas de los nodos de los ejemplos', () => {
    const captacion = nodesOf('captacion-leads');
    const faq = nodesOf('faq-ia');
    const byId = (nodes: Record<string, unknown>[], id: string) => nodes.find((node) => node.id === id)!;
    expect(keys(byId(captacion, 'bienvenida'))).toEqual(['next']);
    expect(keys(byId(captacion, 'pedir-tamano'))).toEqual(['choices[pequena].next', 'choices[mediana].next', 'choices[grande].next']);
    expect(keys(byId(captacion, 'ruta-segmento'))).toEqual(['rules[0].next', 'else']);
    expect(keys(byId(captacion, 'enviar-crm'))).toEqual(['next', 'onError']);
    expect(keys(byId(faq, 'asistente'))).toEqual(['next', 'onExhausted']);
    expect(keys({ id: 'salto', type: 'jump' })).toEqual(['target']);
    for (const node of [...captacion, ...faq].filter((candidate) => candidate.type === 'end')) expect(nodeOutputs(node)).toEqual([]);
    expect(keys(byId(captacion, 'pedir-nombre'))).toEqual(['next']);
    expect(keys(byId(captacion, 'marcar-pyme'))).toEqual(['next']);
  });

  it('el pointer es la identidad y el destino actual va en id', () => {
    const outputs = nodeOutputs(nodesOf('captacion-leads').find((node) => node.id === 'pedir-tamano'));
    expect(outputs.map((output) => [output.pointer, output.id])).toEqual([
      ['/choices/0/next', 'marcar-pyme'],
      ['/choices/1/next', 'marcar-pyme'],
      ['/choices/2/next', 'marcar-empresa'],
    ]);
  });

  it('selección múltiple: ninguna salida por opción, solo el next del nodo (multipleChoiceOutputs)', () => {
    const multiple = { id: 'm', type: 'input', inputType: 'choice', variable: 'v', multiple: true, choices: [{ id: 'a', label: 'A', next: 'x' }, { id: 'b', label: 'B' }], next: 'y' };
    expect(nodeOutputs(multiple)).toEqual([{ key: 'next', pointer: '/next', id: 'y' }]);
    const single = { ...multiple, multiple: false };
    expect(keys(single)).toEqual(['choices[a].next', 'choices[b].next']);
    expect(nodeOutputs(single)[1]!.id).toBeNull();
  });

  it('una opción sin id de texto se etiqueta con su índice, y dos con el mismo id tienen pointer distinto', () => {
    const node = { id: 'i', type: 'input', inputType: 'choice', choices: [{ id: {}, label: '' }, { id: 'a', label: '' }, { id: 'a', label: '' }] };
    expect(nodeOutputs(node).map((output) => [output.key, output.pointer])).toEqual([
      ['choices[0].next', '/choices/0/next'],
      ['choices[a].next', '/choices/1/next'],
      ['choices[a].next', '/choices/2/next'],
    ]);
  });

  it('defensivo: una condición sin rules válidas solo tiene else; un input con choices que no es lista, ninguna de opción', () => {
    expect(keys({ id: 'c', type: 'condition', else: 'x' })).toEqual(['else']);
    expect(keys({ id: 'c', type: 'condition', rules: 5, else: 'x' })).toEqual(['else']);
    expect(keys({ id: 'c', type: 'condition', rules: [null, { next: 'a' }] })).toEqual(['rules[1].next', 'else']);
    expect(keys({ id: 'i', type: 'input', inputType: 'choice', choices: 'x' })).toEqual([]);
    expect(keys({ id: 'i', type: 'input', inputType: 'choice', choices: [null] })).toEqual([]);
  });

  it('un tipo desconocido, y lo que no es un objeto, no tienen salidas', () => {
    for (const node of [{ id: 'x', type: 'desconocido', next: 'a' }, { id: 'x', type: 'constructor' }, null, 5, 'x', []]) expect(nodeOutputs(node)).toEqual([]);
  });

  it('las ocho plantillas de «Añadir nodo» no lanzan', () => {
    const flow = structuredClone(FLOWS.hola) as FlowDoc;
    for (const type of ['message', 'input', 'condition', 'set', 'http', 'llm', 'jump', 'end']) {
      const added = addNode(flow, type, displayPositions(flow), { x: 0, y: 0 })!;
      expect(() => nodeOutputs((added.flow.nodes as unknown[]).at(-1))).not.toThrow();
    }
  });
});
