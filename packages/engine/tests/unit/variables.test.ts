import type { Variable } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { createVariableStore, VariableStore } from '../../src/variables.js';
import type { JsonValue } from '../../src/types.js';

const contactOf = (values: Record<string, JsonValue>) => new Map(Object.entries(values));

describe('createVariableStore', () => {
  const declared: Variable[] = [
    { name: 'email', type: 'email', scope: 'contact', default: 'sin-email' },
    { name: 'segmento', type: 'string', scope: 'session', default: 'pyme' },
    { name: 'libre', type: 'string' },
  ];

  it('el valor de contacto gana al default', () => {
    const store = createVariableStore(declared, contactOf({ email: 'ana@example.com' }));
    expect(store.get('email')).toBe('ana@example.com');
  });

  it('un null inyectado deja el default', () => {
    expect(createVariableStore(declared, contactOf({ email: null })).get('email')).toBe('sin-email');
  });

  it('sin contacto usa el default', () => {
    expect(createVariableStore(declared, contactOf({})).get('email')).toBe('sin-email');
  });

  it('ignora claves ajenas', () => {
    const store = createVariableStore(declared, contactOf({ empresa: 'Acme' }));
    expect(store.isDeclared('empresa')).toBe(false);
    expect(store.get('empresa')).toBeUndefined();
    expect(store.contactVariables()).toEqual({ email: 'sin-email' });
  });

  it('no inyecta en variables de sesión', () => {
    const store = createVariableStore(declared, contactOf({ segmento: 'empresa', libre: 'x' }));
    expect(store.get('segmento')).toBe('pyme');
    expect(store.get('libre')).toBeUndefined();
  });

  it('una variable sin default empieza sin valor y un default null también', () => {
    const store = createVariableStore([{ name: 'a', type: 'string', default: null }, { name: 'b', type: 'string' }], contactOf({}));
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeUndefined();
  });

  it('copia el default: modificar el estado no cambia el flujo', () => {
    const flowVariables: Variable[] = [{ name: 'j', type: 'json', default: { items: [] } }];
    const store = createVariableStore(flowVariables, contactOf({}));
    (store.get('j') as { items: unknown[] }).items.push(1);
    expect(flowVariables[0]!.default).toEqual({ items: [] });
  });

  it('el primer nombre duplicado manda', () => {
    const store = createVariableStore(
      [
        { name: 'a', type: 'string', default: 'uno' },
        { name: 'a', type: 'string', default: 'dos' },
      ],
      contactOf({}),
    );
    expect(store.get('a')).toBe('uno');
  });

  it('los nombres constructor y __proto__ son variables normales', () => {
    const store = new VariableStore([
      { name: 'constructor', type: 'string' },
      { name: '__proto__', type: 'string' },
      { name: 'toString', type: 'string' },
    ]);
    expect(store.get('constructor')).toBeUndefined();
    expect(store.get('__proto__')).toBeUndefined();
    store.set('__proto__', 'x');
    store.set('constructor', 'y');
    expect(store.get('__proto__')).toBe('x');
    const vars = store.sessionVariables();
    expect(Object.keys(vars)).toEqual(['constructor', '__proto__']);
    expect(Object.hasOwn(vars, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(vars))).toEqual(JSON.parse('{"constructor":"y","__proto__":"x"}'));
    expect(Object.getPrototypeOf(vars)).toBe(Object.prototype);
  });
});

describe('VariableStore', () => {
  const store = () =>
    new VariableStore([
      { name: 's1', type: 'string' },
      { name: 'c1', type: 'string', scope: 'contact' },
      { name: 's2', type: 'string', scope: 'session' },
    ]);

  it('set null deja la variable sin valor', () => {
    const s = store();
    s.set('s1', 'x');
    s.set('s1', null);
    expect(s.get('s1')).toBeUndefined();
    expect(s.sessionVariables()).toEqual({});
  });

  it('separa sesión y contacto en orden de declaración', () => {
    const s = store();
    s.set('s2', 1);
    s.set('s1', 'a');
    expect(Object.keys(s.sessionVariables())).toEqual(['s1', 's2']);
    expect(s.contactVariables()).toEqual({ c1: null });
    s.set('c1', 'z');
    expect(s.contactVariables()).toEqual({ c1: 'z' });
  });
});
