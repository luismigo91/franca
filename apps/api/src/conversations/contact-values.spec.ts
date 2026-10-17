import { startSession, type JsonValue } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { diffContact, initialContactView, jsonEqual } from './contact-values.js';

/** Un flujo que termina en el acto: lo único que deja ver es la vista de contacto con la que empieza. */
function endOnly(variables: unknown[]) {
  return { specVersion: '0.1', id: 'solo-end', name: 'Solo end', variables, start: 'fin', nodes: [{ id: 'fin', type: 'end' }] };
}

const contact = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: 'json', scope: 'contact', ...extra });

/** Un valor con `levels` niveles de arrays anidados. */
function nested(levels: number): JsonValue {
  let value: JsonValue = 'hoja';
  for (let level = 0; level < levels; level += 1) value = [value];
  return value;
}

describe('initialContactView', () => {
  it('guardado no nulo, default o null, solo variables de contacto, en orden de declaración', () => {
    const flow = endOnly([contact('a', { default: 'x' }), { name: 'sesion', type: 'string', default: 's' }, contact('b'), contact('c', { default: 'd' })]) as never;
    const view = initialContactView(flow, new Map<string, JsonValue>([['a', 'guardado'], ['b', 'otro'], ['ajena', 'x']]));
    expect(view).toEqual({ a: 'guardado', b: 'otro', c: 'd' });
    expect(Object.keys(view)).toEqual(['a', 'b', 'c']);
  });

  it('sin variables de contacto, vista vacía', () => {
    expect(initialContactView({} as never, new Map())).toEqual({});
  });
});

describe('paridad de la vista inicial con startSession', () => {
  const cases: [string, unknown[], [string, JsonValue][]][] = [
    ['default escalar', [contact('a', { default: 'x' })], []],
    ['default de objeto', [contact('o', { default: { k: [1, { z: null }] } })], []],
    ['el guardado gana al default', [contact('a', { default: 'x' })], [['a', 'guardado']]],
    ['guardado de objeto', [contact('o', { default: 'x' })], [['o', { b: 1, a: [true] }]]],
    ['sin valor ni default', [contact('a')], []],
    ['variable __proto__', [contact('__proto__'), contact('b', { default: 1 })], [['__proto__', 'pp']]],
    ['__proto__ con default', [contact('__proto__', { default: { __proto__: 1 } })], []],
    ['nombre repetido: gana la primera declaración', [contact('a', { default: 'x' }), contact('a', { default: 'y' })], []],
    ['mezcla con variables de sesión', [{ name: 's', type: 'string', default: 'sesion' }, contact('a', { default: 'x' })], [['a', 'g']]],
    ['valor guardado falsy', [contact('n', { default: 5 })], [['n', 0]]],
    ['valor guardado false y vacío', [contact('b', { default: true }), contact('t', { default: 'x' })], [['b', false], ['t', '']]],
  ];

  it.each(cases)('%s', async (_name, variables, stored) => {
    const flow = endOnly(variables);
    const result = await startSession({ flow, contact: Object.fromEntries(stored) });
    if (!result.ok) throw new Error(`startSession rechazó el flujo: ${result.code}`);
    const view = initialContactView(flow as never, new Map(stored));
    expect(view).toEqual(result.state.contact);
    expect(JSON.stringify(view)).toBe(JSON.stringify(result.state.contact));
  });
});

describe('jsonEqual', () => {
  it('compara valores estructuralmente, sin importar el orden de las claves', () => {
    expect(jsonEqual({ a: 1, b: [1, 2, { c: null }] }, { b: [1, 2, { c: null }], a: 1 })).toBe(true);
    expect(jsonEqual('x', 'x')).toBe(true);
    expect(jsonEqual(null, null)).toBe(true);
    expect(jsonEqual(0, 0)).toBe(true);
  });

  it.each([
    [{ a: 1 }, { a: 2 }],
    [{ a: 1 }, { a: 1, b: 1 }],
    [{ a: 1, b: 1 }, { a: 1 }],
    [[1, 2], [2, 1]],
    [[1], [1, 2]],
    [[], {}],
    [{}, []],
    [null, {}],
    [null, 0],
    [0, '0'],
    [false, null],
    ['', null],
    [{ a: undefined as never }, { b: 1 }],
  ])('%j distinto de %j', (left, right) => {
    expect(jsonEqual(left as JsonValue, right as JsonValue)).toBe(false);
  });

  it('claves __proto__ propias, como nombre y anidadas', () => {
    const one = JSON.parse('{"__proto__": {"a": 1}}') as JsonValue;
    const same = JSON.parse('{"__proto__": {"a": 1}}') as JsonValue;
    const other = JSON.parse('{"__proto__": {"a": 2}}') as JsonValue;
    expect(jsonEqual(one, same)).toBe(true);
    expect(jsonEqual(one, other)).toBe(false);
    expect(jsonEqual(one, {})).toBe(false);
  });

  it('un valor de 999 niveles no desborda la pila', () => {
    expect(jsonEqual(nested(999), nested(999))).toBe(true);
    expect(jsonEqual(nested(999), nested(998))).toBe(false);
    expect(jsonEqual(nested(5000), nested(5000))).toBe(true);
  });
});

describe('diffContact', () => {
  it('un valor nuevo se guarda, uno cambiado se guarda y «sin valor» borra', () => {
    const before = { a: null, b: 'x', c: 'z', d: null };
    const after = { a: 'nuevo', b: 'y', c: null, d: null };
    expect(diffContact(before, after)).toEqual({ upserts: [['a', 'nuevo'], ['b', 'y']], deletes: ['c'] });
  });

  it('lo no cambiado no se escribe, tampoco un default igual al inicial', () => {
    const view = { email: 'nadie@example.com', o: { k: [1, 2] } };
    expect(diffContact(view, { email: 'nadie@example.com', o: { k: [1, 2] } })).toEqual({ upserts: [], deletes: [] });
  });

  it('el orden de las claves de un objeto no cuenta como cambio', () => {
    expect(diffContact({ o: { a: 1, b: 2 } }, { o: { b: 2, a: 1 } })).toEqual({ upserts: [], deletes: [] });
  });

  it('un nombre que antes no estaba y ahora no tiene valor no cambia nada', () => {
    expect(diffContact({}, { nuevo: null })).toEqual({ upserts: [], deletes: [] });
  });

  it('__proto__ como nombre y como clave anidada', () => {
    const after = JSON.parse('{"__proto__": "x@example.com", "o": {"__proto__": 2}}') as Record<string, JsonValue>;
    const before = JSON.parse('{"__proto__": null, "o": {"__proto__": 1}}') as Record<string, JsonValue | null>;
    const changes = diffContact(before, after);
    expect(changes.upserts.map(([name]) => name)).toEqual(['__proto__', 'o']);
    expect(Object.getPrototypeOf(changes.upserts[1]![1])).toBe(Object.prototype);
  });

  it('un valor de 999 niveles sin cambios no escribe y sin RangeError', () => {
    expect(diffContact({ j: nested(999) }, { j: nested(999) })).toEqual({ upserts: [], deletes: [] });
    expect(diffContact({ j: nested(999) }, { j: nested(998) }).upserts).toHaveLength(1);
  });
});
