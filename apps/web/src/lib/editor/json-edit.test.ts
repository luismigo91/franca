import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { getIn, parsePointer, pointerOf, removeIn, setIn, type FlowDoc } from '@/lib/editor/json-edit';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const text = (value: unknown) => JSON.stringify(value);

describe('pointerOf y parsePointer (RFC 6901)', () => {
  it('escapa ~ como ~0 y / como ~1, y decodifica en el orden inverso', () => {
    expect(pointerOf(['nodes', 3, 'request', 'headers', 'a/b'])).toBe('/nodes/3/request/headers/a~1b');
    expect(pointerOf(['x~y'])).toBe('/x~0y');
    expect(pointerOf(['~1'])).toBe('/~01');
    expect(parsePointer('/a~1b/x~0y/~01')).toEqual(['a/b', 'x~y', '~1']);
    expect(pointerOf([])).toBe('');
    expect(parsePointer('')).toEqual([]);
  });

  it('ida y vuelta de cualquier nombre de cabecera', () => {
    for (const name of ['a/b', 'x~y', '-', '10', '__proto__', '~/~', '//', '']) expect(parsePointer(pointerOf([name]))).toEqual([name]);
  });

  it('un puntero sin / inicial es un error de programación', () => {
    expect(() => parsePointer('a/b')).toThrow(TypeError);
  });

  it('coincide con el path que da validateFlow para el problema de cada cabecera (a/b, x~y, -, 10, __proto__)', () => {
    for (const name of ['a/b', 'x~y', '-', '10', '__proto__']) {
      const flow = clone('captacion-leads');
      const crm = (flow.nodes as Record<string, unknown>[]).findIndex((node) => node.id === 'enviar-crm');
      // Un valor que no es texto ni secreto da un issue de forma en la ruta exacta de la cabecera.
      (flow.nodes as { request: { headers: unknown } }[])[crm]!.request.headers = JSON.parse(`{${JSON.stringify(name)}: 5}`);
      const verdict = validateFlow(flow);
      expect(verdict.valid).toBe(false);
      expect(verdict.issues.map((issue) => issue.path)).toEqual([pointerOf(['nodes', crm, 'request', 'headers', name])]);
      // Y el puntero llega a su valor: lo que escribe el editor con ese puntero está donde lo señala el validador.
      expect(getIn(flow, verdict.issues[0]!.path)).toBe(5);
    }
  });
});

describe('getIn', () => {
  it('lee por puntero', () => {
    expect(getIn(clone('captacion-leads'), '/nodes/1/variable')).toBe('nombre');
    expect(getIn(clone('captacion-leads'), '')).toEqual(clone('captacion-leads'));
  });

  it('da undefined, sin lanzar, al pasar por algo que no es un objeto ni una lista', () => {
    for (const request of [null, 5, 'x', []]) expect(getIn({ request }, '/request/method')).toBeUndefined();
    expect(getIn({ a: 'ab' }, '/a/0')).toBeUndefined();
    expect(getIn({}, '/constructor')).toBeUndefined();
    expect(getIn({ a: [1] }, '/a/1')).toBeUndefined();
    expect(getIn({ a: [1] }, '/a/x')).toBeUndefined();
    expect(getIn({ a: [1] }, '/a/0')).toBe(1);
  });
});

describe('setIn', () => {
  it('sustituye en su sitio y una clave nueva va al final', () => {
    const flow = clone('captacion-leads');
    const changed = setIn(flow, '/name', 'Otro');
    expect(Object.keys(changed)).toEqual(Object.keys(flow));
    const added = setIn(flow, '/extra', 1);
    expect(Object.keys(added).at(-1)).toBe('extra');
    expect(flow).toEqual(clone('captacion-leads'));
  });

  it('un cambio de texto cambia solo ese texto (el orden del nodo se conserva)', () => {
    const flow = clone('captacion-leads');
    const changed = setIn(flow, '/nodes/2/validation/retryMessage', 'Otro');
    expect(text(changed)).toBe(text(flow).replace('Ese email no parece válido, ¿lo revisas?', 'Otro'));
  });

  it('una cabecera __proto__ es una clave propia más y no toca el prototipo', () => {
    const flow = { request: { headers: { A: 'a' } } } as FlowDoc;
    const changed = setIn(flow, '/request/headers/__proto__', 'x');
    expect(text(changed)).toBe('{"request":{"headers":{"A":"a","__proto__":"x"}}}');
    expect(Object.getPrototypeOf((changed.request as { headers: object }).headers)).toBe(Object.prototype);
    const replaced = setIn(changed, '/request/headers/__proto__', 'y');
    expect(text(replaced)).toBe('{"request":{"headers":{"A":"a","__proto__":"y"}}}');
  });

  it('un body con claves "10" y "a" conserva el texto', () => {
    const flow = JSON.parse('{"body":{"10":1,"a":2,"b":3}}') as FlowDoc;
    expect(text(setIn(flow, '/body/a', 5))).toBe('{"body":{"10":1,"a":5,"b":3}}');
    expect(text(setIn(flow, '/body/constructor', 5))).toBe('{"body":{"10":1,"a":2,"b":3,"constructor":5}}');
  });

  it('crea el paso ausente al final de su padre y escribe dentro (validation de pedir-nombre)', () => {
    const flow = clone('captacion-leads');
    const changed = setIn(flow, '/nodes/1/validation/maxRetries', 2);
    const node = (changed.nodes as Record<string, unknown>[])[1]!;
    expect(text(node)).toBe(text({ ...(flow.nodes as Record<string, unknown>[])[1], validation: { maxRetries: 2 } }));
    expect(Object.keys(node).at(-1)).toBe('validation');
  });

  it('settings.typingDelayMs sobre hola deja settings al final del flujo', () => {
    const changed = setIn(clone('hola'), '/settings/typingDelayMs', 0);
    expect(text(changed)).toBe('{"specVersion":"0.1","id":"hola","name":"Hola","start":"fin","nodes":[{"id":"fin","type":"end"}],"settings":{"typingDelayMs":0}}');
  });

  it('la primera cabecera de un request sin headers crea headers al final de request', () => {
    const flow = { nodes: [{ request: { method: 'GET', url: '' } }] } as FlowDoc;
    expect(text(setIn(flow, '/nodes/0/request/headers/X', 'a'))).toBe('{"nodes":[{"request":{"method":"GET","url":"","headers":{"X":"a"}}}]}');
  });

  it('el tipo del contenedor nuevo lo decide kindAt: una cabecera llamada - crea {} y no una lista', () => {
    const flow = { request: { method: 'GET' } } as FlowDoc;
    expect(text(setIn(flow, '/request/headers/-', 'a', { kindAt: () => 'object' }))).toBe('{"request":{"method":"GET","headers":{"-":"a"}}}');
    expect(text(setIn(flow, '/request/headers/-', 'a'))).toBe('{"request":{"method":"GET","headers":["a"]}}');
    expect(text(setIn(flow, '/list/-', 1, { kindAt: () => 'list' }))).toBe('{"request":{"method":"GET"},"list":[1]}');
  });

  it('solo lanza si un paso existe y no es un contenedor, o si el índice no vale', () => {
    expect(() => setIn({ a: 5 } as FlowDoc, '/a/b', 1)).toThrow(TypeError);
    expect(() => setIn({ a: null } as FlowDoc, '/a/b', 1)).toThrow(TypeError);
    expect(() => setIn({ a: [] } as FlowDoc, '/a/3', 1)).toThrow(TypeError);
    expect(() => setIn({ a: [] } as FlowDoc, '', 1)).toThrow(TypeError);
  });

  it('con el último guardado, una clave nueva vuelve a su sitio', () => {
    const saved = { a: 1, b: 2, c: 3 } as FlowDoc;
    expect(text(setIn({ a: 1, c: 3 } as FlowDoc, '/b', 2, { saved }))).toBe('{"a":1,"b":2,"c":3}');
    expect(text(setIn({ b: 2, c: 3 } as FlowDoc, '/a', 1, { saved }))).toBe('{"a":1,"b":2,"c":3}');
    expect(text(setIn({ a: 1 } as FlowDoc, '/c', 3, { saved }))).toBe('{"a":1,"c":3}');
    expect(text(setIn({ a: 1, c: 3 } as FlowDoc, '/z', 9, { saved }))).toBe('{"a":1,"c":3,"z":9}');
  });

  it('añade al final de una lista con el segmento -', () => {
    expect(text(setIn({ a: [1] } as FlowDoc, '/a/-', 2))).toBe('{"a":[1,2]}');
    expect(text(setIn({ a: [1, 2] } as FlowDoc, '/a/1', 9))).toBe('{"a":[1,9]}');
  });
});

describe('removeIn', () => {
  it('quita una propiedad y un elemento', () => {
    expect(text(removeIn({ a: 1, b: 2 } as FlowDoc, '/a'))).toBe('{"b":2}');
    expect(text(removeIn({ a: [1, 2, 3] } as FlowDoc, '/a/1'))).toBe('{"a":[1,3]}');
  });

  it('sobre un paso ausente o que no es un contenedor no hace nada y devuelve la misma raíz', () => {
    const root = { a: 5, b: null, c: { d: 1 } } as FlowDoc;
    expect(removeIn(root, '/x/y')).toBe(root);
    expect(removeIn(root, '/a/y')).toBe(root);
    expect(removeIn(root, '/b/y')).toBe(root);
    expect(removeIn(root, '/c/zzz')).toBe(root);
    expect(removeIn(root, '/constructor')).toBe(root);
    expect(removeIn(root, '')).toBe(root);
  });
});
