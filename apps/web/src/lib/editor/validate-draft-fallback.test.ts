import { describe, expect, it, vi } from 'vitest';

// Defensa en profundidad: si `validateFlow` lanzara (lo hacía con un `type` como `constructor` hasta #16), el editor sigue.
vi.mock('@franca/spec', async (original) => ({ ...(await original<typeof import('@franca/spec')>()), validateFlow: () => { throw new Error('boom'); } }));

const { validateDraft } = await import('@/lib/editor/validate-draft');

describe('validateDraft cuando validateFlow lanza', () => {
  it('da «tipo de nodo desconocido» para los nodos de tipo no válido y nunca lanza', () => {
    const flow = { nodes: [null, { id: 'a', type: 'constructor' }, { id: 'b', type: 'end' }] };
    expect(validateDraft(flow)).toEqual({ valid: false, issues: [{ layer: 'shape', path: '/nodes/1', nodeId: 'a', message: 'tipo de nodo desconocido: "constructor"' }], warnings: [] });
    expect(validateDraft({ nodes: [{ id: 'b', type: 'end' }] }).issues).toEqual([{ layer: 'shape', path: '', message: 'no se ha podido validar el flujo' }]);
    expect(() => validateDraft(5)).not.toThrow();
  });
});
