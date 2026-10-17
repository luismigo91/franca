import { describe, expect, it } from 'vitest';
import { exceedsFlowDepth, MAX_FLOW_DEPTH } from '../src/depth.js';

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
