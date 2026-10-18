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

  it('un type como constructor, toString o __proto__ da «tipo de nodo desconocido», igual que validateFlow', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(validateDraft(withType(type)), type).toEqual(validateFlow(withType(type)));
      expect(validateDraft(withType(type)).issues).toEqual([{ layer: 'shape', path: '/nodes/0', nodeId: 'a', message: `tipo de nodo desconocido: "${type}"` }]);
    }
  });

  it('nunca lanza', () => {
    for (const value of [null, 5, 'x', [], {}, { nodes: 'x' }, { nodes: [null, { type: 'constructor' }] }]) expect(() => validateDraft(value)).not.toThrow();
  });
});
