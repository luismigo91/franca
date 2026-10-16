import { describe, expect, it } from 'vitest';
import { MAX_MAPPED_VALUE_DEPTH, MAX_RENDERED_LENGTH } from '../../src/constants.js';
import { checkPointerEscapes, decodePointer, mapResponse, resolvePointer } from '../../src/http/response-map.js';

const chain = (levels: number): unknown => {
  let value: unknown = 1;
  for (let i = 0; i < levels; i++) value = [value];
  return value;
};
const entry = (pointer: string, variable = 'v') => ({ variable, pointer });
/** Mapea un solo puntero sobre un cuerpo y devuelve el valor asignado, `null` (sin valor) o 'INVALID'. */
function mapOne(body: string, pointer: string): unknown {
  const result = mapResponse(body, [entry(pointer)]);
  return result.ok ? result.assignments[0]![1] : 'INVALID';
}

describe('checkPointerEscapes', () => {
  it.each(['', '/', '/a', '/a~0', '/a~1', '/~01', '/~10', '/~0~1'])('%j válido', (p) => expect(checkPointerEscapes(p)).toBe(true));
  it.each(['/a~2', '/a~', '~', '/~a', '/~~', '/a~/b'])('%j inválido', (p) => expect(checkPointerEscapes(p)).toBe(false));
});

describe('decodePointer', () => {
  it.each([
    ['', []],
    ['/', ['']],
    ['/a/b', ['a', 'b']],
    ['/a~1b', ['a/b']],
    ['/m~0n', ['m~n']],
    ['/~01', ['~1']],
    ['/~10', ['/0']],
    ['//', ['', '']],
    ['/a/', ['a', '']],
    ['/~0~1', ['~/']],
  ])('%j → %j', (pointer, tokens) => expect(decodePointer(pointer)).toEqual(tokens));
});

describe('resolvePointer: índices de array', () => {
  const doc = ['a', 'b', 'c'];
  it.each([
    ['0', 'a'],
    ['1', 'b'],
    ['2', 'c'],
  ])('índice %s', (token, value) => expect(resolvePointer(doc, [token])).toBe(value));

  it.each(['01', '-', '1e1', ' 1', '0x1', '+1', '3', '-1', '', '1.0', '999999999999999999999', '00', 'a', '١'])(
    'el token %j no encuentra nada',
    (token) => expect(resolvePointer(doc, [token])).toBeUndefined(),
  );

  it('índice fuera de rango y enorme', () => {
    expect(resolvePointer(doc, ['3'])).toBeUndefined();
    expect(resolvePointer(doc, [String(2 ** 32)])).toBeUndefined();
  });
});

describe('resolvePointer: objetos y escalares', () => {
  it('solo propiedades propias; __proto__ del cuerpo se encuentra y constructor no', () => {
    const doc = JSON.parse('{"__proto__": "p", "a": 1}');
    expect(resolvePointer(doc, ['__proto__'])).toBe('p');
    expect(resolvePointer(doc, ['constructor'])).toBeUndefined();
    expect(resolvePointer(doc, ['toString'])).toBeUndefined();
    expect(resolvePointer(doc, ['hasOwnProperty'])).toBeUndefined();
  });

  it('sobre un escalar no encuentra nada', () => {
    for (const scalar of [1, 'x', true, null]) expect(resolvePointer(scalar, ['a'])).toBeUndefined();
    expect(resolvePointer({ n: 3 }, ['n', 'x'])).toBeUndefined();
  });

  it('el documento entero con tokens vacíos', () => {
    const doc = { a: 1 };
    expect(resolvePointer(doc, [])).toBe(doc);
  });

  it('una propiedad con valor undefined no existe en JSON; null se encuentra como null', () => {
    expect(resolvePointer({ a: null }, ['a'])).toBeNull();
  });
});

describe('mapResponse', () => {
  it('Tipos y punteros', () => {
    const body = '{"n": 3, "ok": true, "lista": [1, {"a": "x"}], "o": {"b": null}}';
    const result = mapResponse(body, [entry('/n'), entry('/ok'), entry('/lista/1/a'), entry('/lista'), entry('')]);
    expect(result).toEqual({
      ok: true,
      assignments: [['v', 3], ['v', true], ['v', 'x'], ['v', [1, { a: 'x' }]], ['v', JSON.parse(body)]],
    });
  });

  it('Escapes y nombres de Object', () => {
    const body = '{"a/b": 1, "m~n": 2, "__proto__": "p"}';
    expect(mapOne(body, '/a~1b')).toBe(1);
    expect(mapOne(body, '/m~0n')).toBe(2);
    expect(mapOne(body, '/__proto__')).toBe('p');
    expect(mapOne(body, '/constructor')).toBeNull();
  });

  it('el escape ~01 es la clave literal ~1', () => {
    expect(mapOne('{"~1": "x", "/": "y"}', '/~01')).toBe('x');
    expect(mapOne('{"~1": "x", "/": "y"}', '/~1')).toBe('y');
  });

  it('punteros que no encuentran nada o encuentran null dejan la variable sin valor', () => {
    const body = '{"n": 3, "lista": [1, 2], "o": {"b": null}}';
    for (const pointer of ['/o/b', '/falta', '/lista/2', '/lista/01', '/lista/-', '/n/x']) expect(mapOne(body, pointer), pointer).toBeNull();
  });

  it('todo o nada: una entrada inválida invalida todas', () => {
    const body = JSON.stringify({ a: 'nuevo', b: 'x'.repeat(MAX_RENDERED_LENGTH + 1) });
    expect(mapResponse(body, [entry('/a', 'a'), entry('/b', 'b')])).toEqual({ ok: false });
  });

  it('el último gana si una variable se repite (el orden de las asignaciones se conserva)', () => {
    const result = mapResponse('{"a": 1, "b": 2}', [entry('/a', 'v'), entry('/b', 'v')]);
    expect(result).toEqual({ ok: true, assignments: [['v', 1], ['v', 2]] });
  });

  it.each(['<html>', '', '{', 'undefined', 'NaN', "{'a':1}"])('el cuerpo %j no es JSON', (body) => {
    expect(mapResponse(body, [entry('/id')])).toEqual({ ok: false });
  });

  it('100 y 101 niveles; 16384 y 16385 unidades', () => {
    expect(mapOne(JSON.stringify({ v: chain(MAX_MAPPED_VALUE_DEPTH) }), '/v')).toEqual(chain(MAX_MAPPED_VALUE_DEPTH));
    expect(mapOne(JSON.stringify({ v: chain(MAX_MAPPED_VALUE_DEPTH + 1) }), '/v')).toBe('INVALID');
    expect(mapOne(JSON.stringify({ v: 'a'.repeat(MAX_RENDERED_LENGTH) }), '/v')).toHaveLength(MAX_RENDERED_LENGTH);
    expect(mapOne(JSON.stringify({ v: 'a'.repeat(MAX_RENDERED_LENGTH + 1) }), '/v')).toBe('INVALID');
  });

  it('el límite de unidades es sobre la forma textual: un array cuyo JSON pasa de 16384', () => {
    const items = Array.from({ length: 5000 }, () => 1234);
    expect(mapOne(JSON.stringify({ v: items }), '/v')).toBe('INVALID');
  });

  it('U+0000 y sustitutos sueltos en strings y en claves', () => {
    expect(mapOne('{"v": "a\\u0000"}', '/v')).toBe('INVALID');
    expect(mapOne('{"v": "\\ud800"}', '/v')).toBe('INVALID');
    expect(mapOne('{"v": "\\udc00x"}', '/v')).toBe('INVALID');
    expect(mapOne('{"v": {"k\\u0000": 1}}', '/v')).toBe('INVALID');
    expect(mapOne('{"v": {"a": {"k\\ud800": 1}}}', '/v')).toBe('INVALID');
    expect(mapOne('{"v": ["ok", ["\\u0000"]]}', '/v')).toBe('INVALID');
  });

  it('un par sustituto completo se admite', () => {
    expect(mapOne('{"v": "\\ud83d\\ude00"}', '/v')).toBe('\u{1F600}');
  });

  it('1e400 y -0', () => {
    expect(mapOne('{"v": 1e400}', '/v')).toBe('INVALID');
    expect(mapOne('{"v": [1e400]}', '/v')).toBe('INVALID');
    const zero = mapOne('{"v": -0}', '/v');
    expect(Object.is(zero, 0)).toBe(true);
  });

  it('lo que no se mapea no cuenta: otro campo con 100000 niveles', () => {
    const body = `{"v": "ok", "w": ${'['.repeat(100000)}${']'.repeat(100000)}}`;
    expect(mapOne(body, '/v')).toBe('ok');
  });

  it('un valor mapeado es una copia independiente del documento', () => {
    const result = mapResponse('{"v": {"a": [1]}}', [entry('/v'), entry('/v')]);
    expect(result.ok && result.assignments[0]![1]).not.toBe(result.ok && result.assignments[1]![1]);
  });
});
