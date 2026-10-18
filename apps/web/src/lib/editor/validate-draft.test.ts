import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { validateDraft } from '@/lib/editor/validate-draft';

const withType = (type: unknown) => ({ specVersion: '0.1', id: 'a', name: 'A', start: 'a', nodes: [{ id: 'a', type }, { id: 'b', type: 'end' }] });

describe('validateDraft', () => {
  it('da el mismo veredicto que validateFlow cuando este no lanza', () => {
    expect(validateDraft(FLOWS['captacion-leads'])).toEqual(validateFlow(FLOWS['captacion-leads']));
    expect(validateDraft(withType('x'))).toEqual(validateFlow(withType('x')));
    expect(validateDraft({ id: 'x' })).toEqual(validateFlow({ id: 'x' }));
  });

  it('un type como constructor, toString o __proto__ (que hace lanzar a validateFlow) da «tipo de nodo desconocido»', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(() => validateFlow(withType(type)), `${type} lanzaba en validateFlow`).toThrow();
      expect(validateDraft(withType(type))).toEqual({
        valid: false,
        issues: [{ layer: 'shape', path: '/nodes/0', nodeId: 'a', message: `tipo de nodo desconocido: "${type}"` }],
        warnings: [],
      });
    }
  });

  it('nunca lanza', () => {
    for (const value of [null, 5, 'x', [], {}, { nodes: 'x' }, { nodes: [null, { type: 'constructor' }] }]) expect(() => validateDraft(value)).not.toThrow();
    expect(validateDraft({ nodes: [null, { type: 'constructor' }] }).issues[0]).toMatchObject({ path: '/nodes/1' });
  });
});
