import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { leads } from './helpers/flows.js';

const CAP_MESSAGE = 'hay más errores: solo se muestran los 100 primeros';

describe('Tope de issues', () => {
  it('Más errores que el tope', () => {
    const flow = leads();
    flow.nodes = Array.from({ length: 150 }, () => ({}));
    const { issues } = validateFlow(flow);
    expect(issues).toHaveLength(101);
    expect(issues.slice(0, 100)).toEqual(
      Array.from({ length: 100 }, (_, i) => ({ layer: 'shape', path: `/nodes/${i}`, message: 'tipo de nodo desconocido: null' })),
    );
    expect(issues[100]).toEqual({ layer: 'shape', path: '', code: 'too_many_issues', message: CAP_MESSAGE });
  });

  it('Justo en el tope', () => {
    const flow = leads();
    flow.nodes = Array.from({ length: 100 }, () => ({}));
    const { issues } = validateFlow(flow);
    expect(issues).toHaveLength(100);
    expect(issues.some((issue) => issue.code !== undefined)).toBe(false);
  });

  it('Tope de errores semánticos', () => {
    const flow = leads();
    for (let i = 0; i < 150; i++) {
      flow.nodes.push({ id: `extra-${i}`, type: 'message', content: [{ kind: 'text', text: 'hola' }], next: 'fin-pyme' });
    }
    const { issues } = validateFlow(flow);
    expect(issues).toHaveLength(101);
    expect(issues.every((issue) => issue.layer === 'semantic')).toBe(true);
    expect(issues[100]).toEqual({ layer: 'semantic', path: '', code: 'too_many_issues', message: CAP_MESSAGE });
  });

  it('El issue de profundidad no lleva código', () => {
    const flow = leads();
    let json: unknown = 1;
    for (let level = 0; level < 998; level++) json = [json];
    flow.variables.push({ name: 'j', type: 'json', default: json });
    const { issues } = validateFlow(flow);
    expect(issues).toHaveLength(1);
    expect(Object.hasOwn(issues[0]!, 'code')).toBe(false);
  });
});
