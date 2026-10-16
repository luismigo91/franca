import { describe, expect, it } from 'vitest';
import { cloneJsonStrict, deepEqual, exceedsDepth, toJsonForm } from '../../src/json.js';

describe('toJsonForm', () => {
  it('copia sin compartir referencias', () => {
    const original = { a: { b: [1, 2] } };
    const copy = toJsonForm(original) as typeof original;
    expect(copy).toEqual(original);
    expect(copy.a).not.toBe(original.a);
  });

  it('aplica la semántica de JSON.stringify', () => {
    expect(toJsonForm({ n: Infinity, m: NaN, u: undefined, d: new Date(0), z: -0 })).toEqual({
      n: null,
      m: null,
      d: '1970-01-01T00:00:00.000Z',
      z: 0,
    });
    expect(Object.is((toJsonForm({ z: -0 }) as { z: number }).z, 0)).toBe(true);
  });

  it('toma toJSON del objeto', () => {
    expect(toJsonForm({ text: { toJSON: () => 'Hola' } })).toEqual({ text: 'Hola' });
  });

  it('devuelve undefined si stringify no produce nada', () => {
    expect(toJsonForm(undefined)).toBeUndefined();
    expect(toJsonForm(() => 1)).toBeUndefined();
    expect(toJsonForm(Symbol('x'))).toBeUndefined();
  });

  it('conserva claves __proto__ como propias', () => {
    const copy = toJsonForm(JSON.parse('{"__proto__":{"x":1}}')) as object;
    expect(Object.hasOwn(copy, '__proto__')).toBe(true);
  });

  it('lanza con ciclos y bigint (defecto del host)', () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => toJsonForm(cyc)).toThrow();
    expect(() => toJsonForm({ n: 1n })).toThrow();
  });
});

const checkJsonValue = (value: unknown): boolean => cloneJsonStrict(value).ok;

describe('cloneJsonStrict (estricto)', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const cyclicArray: unknown[] = [];
  cyclicArray.push(cyclicArray);
  class Point {
    x = 1;
  }

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['undefined', undefined],
    ['función', () => 1],
    ['símbolo', Symbol('s')],
    ['bigint', 1n],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['instancia de clase', new Point()],
    ['array disperso', [1, , 3]], // eslint-disable-line no-sparse-arrays
    ['ciclo en objeto', cyclic],
    ['ciclo en array', cyclicArray],
    ['no JSON anidado', { a: [{ b: undefined }] }],
  ])('rechaza %s', (_name, value) => {
    expect(checkJsonValue(value)).toBe(false);
  });

  it.each([
    ['null', null],
    ['string', 'x'],
    ['number', 1.5],
    ['boolean', false],
    ['array', [1, 'a', null, [true]]],
    ['objeto', { a: { b: [1] } }],
    ['objeto sin prototipo', Object.assign(Object.create(null), { a: 1 })],
  ])('acepta %s', (_name, value) => {
    expect(checkJsonValue(value)).toBe(true);
  });

  it('acepta el mismo objeto referenciado dos veces (sin ciclo)', () => {
    const shared = { a: 1 };
    expect(checkJsonValue({ x: shared, y: shared })).toBe(true);
  });

  it('normaliza -0 a 0 en la copia', () => {
    const copy = cloneJsonStrict([-0]);
    expect(copy.ok && Object.is((copy.value as number[])[0], 0)).toBe(true);
  });

  it('conserva __proto__ como propiedad propia y no toca el original', () => {
    const input = JSON.parse('{"__proto__":"x","a":[1]}');
    const copy = cloneJsonStrict(input);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(Object.hasOwn(copy.value as object, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(copy.value)).toBe(Object.prototype);
    expect((copy.value as { a: number[] }).a).not.toBe(input.a);
  });
});

describe('deepEqual', () => {
  it('ignora el orden de las claves y respeta el de los arrays', () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] })).toBe(false);
  });

  it('no aplica coerción', () => {
    expect(deepEqual([1, 2], ['1', '2'])).toBe(false);
    expect(deepEqual({ a: null }, { a: 0 })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it('distingue claves distintas con el mismo número de claves', () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });
});

describe('exceedsDepth', () => {
  const nest = (n: number): unknown => {
    let v: unknown = 1;
    for (let i = 0; i < n; i++) v = [v];
    return v;
  };

  it('un escalar vale 0 y [[1]] vale 2', () => {
    expect(exceedsDepth(1, 0)).toBe(false);
    expect(exceedsDepth(null, 0)).toBe(false);
    expect(exceedsDepth({}, 0)).toBe(true);
    expect(exceedsDepth(nest(2), 2)).toBe(false);
    expect(exceedsDepth(nest(2), 1)).toBe(true);
  });

  it('no recursa: 1 000 000 de niveles sin desbordar', () => {
    expect(exceedsDepth(nest(1_000_000), 1000)).toBe(true);
  });

  it('un ciclo cuenta como demasiado profundo', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(exceedsDepth(a, 1000)).toBe(true);
  });

  it('un grafo compartido no es exponencial', () => {
    let v: unknown = { leaf: 1 };
    for (let i = 0; i < 60; i++) v = { a: v, b: v };
    expect(exceedsDepth(v, 1000)).toBe(false);
  });

  it('un array disperso enorme es barato', () => {
    const sparse: unknown[] = [];
    sparse[2 ** 31] = [1];
    expect(exceedsDepth(sparse, 1000)).toBe(false);
  });

  it('cloneJsonStrict lo rechaza sin recursar', () => {
    expect(cloneJsonStrict(nest(1001)).ok).toBe(false);
    expect(cloneJsonStrict(nest(1000)).ok).toBe(true);
  });
});
