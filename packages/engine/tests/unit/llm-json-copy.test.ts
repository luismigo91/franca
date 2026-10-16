import { describe, expect, it } from 'vitest';
import { copyJsonValue } from '../../src/llm/json-copy.js';

/** Un array anidado `levels` veces: `nest(3)` es `[[[]]]`. Se construye sin recursión. */
function nest(levels: number): unknown {
  let value: unknown = [];
  for (let i = 1; i < levels; i++) value = [value];
  return value;
}

const accepted = (value: unknown): unknown => {
  const copy = copyJsonValue(value);
  expect(copy.ok, JSON.stringify(copy)).toBe(true);
  return (copy as { value: unknown }).value;
};
const rejected = (value: unknown): void => expect(copyJsonValue(value)).toEqual({ ok: false });

describe('copyJsonValue: formas válidas', () => {
  it.each([
    ['un objeto con un array', { a: [1, 'x'] }],
    ['un string de primer nivel', 'texto'],
    ['un number', 3.5],
    ['un boolean', false],
    ['un array vacío', []],
    ['un objeto vacío', {}],
    ['anidado mixto', { a: { b: [true, null, { c: 'd' }] }, e: -2 }],
    ['null dentro', [null]],
    ['un string vacío de primer nivel', ''],
  ])('%s se copia igual', (_name, value) => {
    expect(accepted(value)).toEqual(value);
  });

  it('devuelve una copia independiente', () => {
    const source = { a: [1, { b: 2 }] };
    const copy = accepted(source) as typeof source;
    expect(copy).not.toBe(source);
    expect(copy.a).not.toBe(source.a);
    expect(copy.a[1]).not.toBe(source.a[1]);
  });

  it('-0 se copia como 0, en primer nivel y dentro', () => {
    expect(Object.is(accepted(-0), 0)).toBe(true);
    expect(Object.is((accepted([-0]) as number[])[0], 0)).toBe(true);
    expect(Object.is((accepted({ a: -0 }) as { a: number }).a, 0)).toBe(true);
  });

  it('una clave __proto__ propia (JSON.parse) se conserva como propiedad propia', () => {
    const source = JSON.parse('{"__proto__": {"x": 1}, "y": 2}') as object;
    const copy = accepted(source) as object;
    expect(Object.hasOwn(copy, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(source));
  });

  it('acepta objetos sin prototipo', () => {
    expect(accepted(Object.assign(Object.create(null), { a: 1 }))).toEqual({ a: 1 });
  });

  it('el orden de las claves se conserva', () => {
    expect(Object.keys(accepted({ z: 1, a: 2, m: 3 }) as object)).toEqual(['z', 'a', 'm']);
  });
});

describe('copyJsonValue: formas rechazadas', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['NaN dentro', [Number.NaN]],
    ['Infinity en un objeto', { a: Infinity }],
    ['undefined', undefined],
    ['undefined dentro de un objeto', { a: undefined }],
    ['undefined dentro de un array', [undefined]],
    ['una función', () => 1],
    ['una función dentro', { f: () => 1 }],
    ['un símbolo', Symbol('s')],
    ['un símbolo dentro', [Symbol('s')]],
    ['un bigint', 10n],
    ['un bigint dentro', { n: 10n }],
    ['una instancia de clase', new (class Foo { a = 1; })()],
    ['una instancia de clase dentro', [new (class Foo { a = 1; })()]],
    ['un Date', new Date(0)],
    ['un Map', new Map()],
    ['un array con otro prototipo', Object.setPrototypeOf([1], { length: 1 })],
    ['un array con hueco', [1, , 3]], // eslint-disable-line no-sparse-arrays
    ['un array disperso', Object.assign([], { length: 5 })],
    ['un objeto con prototipo ajeno', Object.create({ a: 1 })],
  ])('%s', (_name, value) => {
    rejected(value);
  });

  it.each([
    ['U+0000 en un string de primer nivel', 'a\u0000b'],
    ['sustituto alto suelto', 'a\ud800'],
    ['sustituto bajo suelto', '\udc00a'],
    ['U+0000 en un string dentro de un array', ['a\u0000']],
    ['sustituto suelto en un string dentro de un objeto', { a: 'x\ud800y' }],
    ['U+0000 en una clave', { 'k\u0000': 1 }],
    ['sustituto suelto en una clave', { 'k\ud800': 1 }],
  ])('%s', (_name, value) => {
    rejected(value);
  });

  it('un par de sustitutos válido sí se acepta', () => {
    expect(accepted('😀')).toBe('😀');
    expect(accepted({ '😀': ['😀'] })).toEqual({ '😀': ['😀'] });
  });

  it('un ciclo se rechaza, no se cuelga', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    rejected(cycle);
    const loop: unknown[] = [];
    loop.push(loop);
    rejected(loop);
  });
});

describe('copyJsonValue: bordes de profundidad (100/101) y de tamaño (4096/4097)', () => {
  it('100 niveles se aceptan y 101 no', () => {
    expect(accepted(nest(100))).toEqual(nest(100));
    rejected(nest(101));
  });

  it('100 niveles de objetos se aceptan y 101 no', () => {
    const objects = (levels: number): unknown => {
      let value: unknown = {};
      for (let i = 1; i < levels; i++) value = { k: value };
      return value;
    };
    expect(accepted(objects(100))).toEqual(objects(100));
    rejected(objects(101));
  });

  it('un string de primer nivel de 4096 caracteres se acepta (su forma textual es el string sin comillas) y uno de 4097 no', () => {
    expect(accepted('a'.repeat(4096))).toBe('a'.repeat(4096));
    rejected('a'.repeat(4097));
  });

  it('dentro de un array un string suma longitud + 2: 4093 caben (4093 + 2 + 2 corchetes = 4097 no; 4092 sí)', () => {
    // "[" + comillas + texto + comillas + "]" = texto + 4
    expect(accepted(['a'.repeat(4092)])).toEqual(['a'.repeat(4092)]);
    rejected(['a'.repeat(4093)]);
  });

  it('dentro de un objeto cuenta además la clave: texto + clave + 8', () => {
    // {"k":"..."} = 2 + (1 + 2 + 1) + 2 + texto = texto + 8
    expect(accepted({ k: 'a'.repeat(4088) })).toEqual({ k: 'a'.repeat(4088) });
    rejected({ k: 'a'.repeat(4089) });
  });

  it('un array de 2047 unos mide 4095 y uno de 2048 mide 4097', () => {
    expect(accepted(Array.from({ length: 2047 }, () => 1))).toHaveLength(2047);
    rejected(Array.from({ length: 2048 }, () => 1));
  });

  it('un array con más de 4096 elementos se rechaza de entrada', () => {
    rejected(Array.from({ length: 4097 }, () => 0));
    rejected(new Array(4097).fill(null));
  });

  it('el límite de tamaño de las claves cuenta aunque los valores sean pequeños', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 700; i++) wide[`clave${i}`] = 1;
    rejected(wide);
  });
});

describe('copyJsonValue: una pasada, cada propiedad una vez', () => {
  it('un getter que cambia entre lecturas se lee una vez y se guarda lo leído', () => {
    let reads = 0;
    const source = {
      get a() {
        reads++;
        return reads === 1 ? 1 : [[[]]];
      },
    };
    expect(accepted(source)).toEqual({ a: 1 });
    expect(reads).toBe(1);
  });

  it('una lectura que lanza propaga la excepción (el llamador la trata como defecto del host)', () => {
    const source = [[new Proxy([], { get() { throw new Error('lectura'); } })]];
    expect(() => copyJsonValue(source)).toThrow('lectura');
  });

  it('un getter que lanza en una propiedad de un objeto propaga', () => {
    const source = {
      get a(): never {
        throw new Error('getter');
      },
    };
    expect(() => copyJsonValue(source)).toThrow('getter');
  });

  it('Object.keys se llama una vez por objeto', () => {
    let keysCalls = 0;
    const target = { a: 1, b: { c: 2 } };
    const proxy = new Proxy(target, {
      ownKeys(t) {
        keysCalls++;
        return Reflect.ownKeys(t);
      },
    });
    accepted(proxy);
    expect(keysCalls).toBe(1);
  });
});
