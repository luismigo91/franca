import { targets, type Node } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { nodeTargets } from '@/lib/editor/node-targets';

const nodesOf = (name: 'captacion-leads' | 'faq-ia') => (FLOWS[name] as { nodes: Node[] }).nodes;

describe('nodeTargets', () => {
  it('da lo mismo que targets en los nodos válidos de los ejemplos', () => {
    for (const node of [...nodesOf('captacion-leads'), ...nodesOf('faq-ia')]) expect(nodeTargets(node)).toEqual(targets(node));
  });

  it('no lanza con nodos de forma inválida y da los saltos legibles', () => {
    const malformed: unknown[] = [
      { id: 'a', type: 'condition' },
      { id: 'a', type: 'condition', rules: 5, else: 'x' },
      { id: 'a', type: 'condition', rules: [null], else: 'x' },
      { id: 'a', type: 'input', choices: 'x' },
      { id: 'a', type: 'input', choices: [null] },
      { id: 'a', type: 'input', choices: null, next: 'z' },
      { id: 'a', type: 'desconocido', next: 'b' },
      null,
      5,
      'x',
      [],
    ];
    for (const node of malformed) expect(() => nodeTargets(node)).not.toThrow();
    expect(nodeTargets({ id: 'a', type: 'condition', rules: [null], else: 'x' })).toEqual([{ key: 'else', pointer: '/else', id: 'x' }]);
    expect(nodeTargets({ id: 'a', type: 'condition', else: 'x' })).toEqual([{ key: 'else', pointer: '/else', id: 'x' }]);
    expect(nodeTargets({ id: 'a', type: 'input', choices: 'x', next: 'q' })).toEqual([{ key: 'next', pointer: '/next', id: 'q' }]);
    expect(nodeTargets({ id: 'a', type: 'desconocido', next: 'b' })).toEqual([{ key: 'next', pointer: '/next', id: 'b' }]);
  });

  it('en los dos caminos solo da saltos con id de texto', () => {
    // Camino de targets (forma válida): la regla de la plantilla, sin next, y {next: 5}.
    expect(nodeTargets({ id: 'c', type: 'condition', rules: [{ when: { variable: '', op: 'eq' } }], else: 'x' }).map((target) => target.key)).toEqual(['else']);
    expect(nodeTargets({ id: 'c', type: 'condition', rules: [{ next: 5 }], else: 'x' }).map((target) => target.key)).toEqual(['else']);
    // Camino legible (otra regla es null).
    expect(nodeTargets({ id: 'c', type: 'condition', rules: [{ next: 5 }, null], else: 'x' }).map((target) => target.key)).toEqual(['else']);
    expect(nodeTargets({ id: 'i', type: 'input', choices: [{ id: 'a', label: '', next: 5 }, null] })).toEqual([]);
    expect(nodeTargets({ id: 'j', type: 'jump', target: 5 })).toEqual([]);
  });

  it('la clave de una opción usa su índice si su id no es texto', () => {
    expect(nodeTargets({ id: 'i', type: 'input', choices: [{ id: {}, label: '', next: 'a' }] })).toEqual([{ key: 'choices[0].next', pointer: '/choices/0/next', id: 'a' }]);
    expect(nodeTargets({ id: 'i', type: 'input', choices: [null, { id: 7, label: '', next: 'a' }] })).toEqual([{ key: 'choices[1].next', pointer: '/choices/1/next', id: 'a' }]);
    expect(nodeTargets({ id: 'i', type: 'input', choices: [{ id: 'p', label: '', next: 'a' }] })).toEqual([{ key: 'choices[p].next', pointer: '/choices/0/next', id: 'a' }]);
  });
});
