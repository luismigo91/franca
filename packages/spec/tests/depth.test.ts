import { describe, expect, it } from 'vitest';
import { exceedsFlowDepth, MAX_FLOW_DEPTH } from '../src/depth.js';
import { validateFlow } from '../src/index.js';
import { leads } from './helpers/flows.js';

/** `levels` arrays anidados: `nested(2)` es `[[1]]`. */
function nested(levels: number): unknown {
  let value: unknown = 1;
  for (let i = 0; i < levels; i++) value = [value];
  return value;
}

describe('exceedsFlowDepth', () => {
  it('mide como el motor: un escalar vale 0 y [[1]] vale 2', () => {
    expect([1, 'a', null, undefined, true].map((v) => exceedsFlowDepth(v, 0))).toEqual([false, false, false, false, false]);
    expect(exceedsFlowDepth([], 0)).toBe(true);
    expect(exceedsFlowDepth([[1]], 2)).toBe(false);
    expect(exceedsFlowDepth([[1]], 1)).toBe(true);
    expect(exceedsFlowDepth({ a: { b: 1 } }, 2)).toBe(false);
    expect(exceedsFlowDepth({ a: { b: 1 } }, 1)).toBe(true);
  });

  it('el límite por defecto es 1000: 1000 niveles caben y 1001 no', () => {
    expect(MAX_FLOW_DEPTH).toBe(1000);
    expect(exceedsFlowDepth(nested(1000))).toBe(false);
    expect(exceedsFlowDepth(nested(1001))).toBe(true);
  });

  it('no lanza con un millón de niveles', () => {
    const deep = nested(1_000_000);
    expect(() => exceedsFlowDepth(deep)).not.toThrow();
    expect(exceedsFlowDepth(deep)).toBe(true);
  });

  it('un ciclo cuenta como demasiado profundo', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(exceedsFlowDepth(cyclic)).toBe(true);
  });

  it('un array disperso enorme es barato', () => {
    const sparse = new Array(2 ** 31);
    sparse[0] = [1];
    const started = performance.now();
    expect(exceedsFlowDepth(sparse)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('una estructura compartida no se recorre una vez por camino', () => {
    // 60 niveles de [x, x] sobre el mismo x: 2^60 caminos si se recorriera cada uno.
    let shared: unknown = 1;
    for (let i = 0; i < 60; i++) shared = [shared, shared];
    const started = performance.now();
    expect(exceedsFlowDepth(shared)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('Profundidad máxima en la validación', () => {
  const DEPTH_ISSUE = {
    layer: 'shape',
    path: '',
    message: 'el flujo supera la profundidad máxima de anidamiento (1000)',
  };

  /** `captacion-leads` con la regla `when` de `ruta-segmento` anidada en `levels` predicados `all` de un elemento. */
  function leadsWithNestedWhen(levels: number): any {
    const flow = leads();
    let when: unknown = { variable: 'segmento', op: 'eq', value: 'empresa' };
    for (let i = 0; i < levels; i++) when = { all: [when] };
    flow.nodes[7].rules[0].when = when;
    return flow;
  }

  /** `captacion-leads` con una variable `j` de tipo `json` cuyo `default` anida `levels` arrays. */
  function leadsWithJsonDefault(levels: number): any {
    const flow = leads();
    flow.variables.push({ name: 'j', type: 'json', default: nested(levels) });
    return flow;
  }

  it('Predicado demasiado anidado', () => {
    const flow = leadsWithNestedWhen(5000);
    expect(() => validateFlow(flow)).not.toThrow();
    const result = validateFlow(flow);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([DEPTH_ISSUE]);
    expect(result.warnings).toEqual([]);
  });

  it('Justo en el límite', () => {
    expect(validateFlow(leadsWithJsonDefault(997)).valid).toBe(true);
    expect(validateFlow(leadsWithJsonDefault(998)).issues).toEqual([DEPTH_ISSUE]);
  });

  it('Predicado anidado hasta el límite', () => {
    // when está a 6 niveles; cada `all` suma 2 (objeto y array): 497 niveles de `all` llegan a 1000.
    expect(exceedsFlowDepth(leadsWithNestedWhen(497))).toBe(false);
    expect(exceedsFlowDepth(leadsWithNestedWhen(498))).toBe(true);
    const result = validateFlow(leadsWithNestedWhen(497));
    expect(result.issues).not.toContainEqual(DEPTH_ISSUE);
  });
});
