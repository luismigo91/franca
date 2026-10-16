import { describe, expect, it } from 'vitest';
import { readTextInput, readUserInput } from '../../src/input/user-input.js';
import { choiceNode, inputNode } from '../helpers/input-node.js';

const text = inputNode('text');
const single = choiceNode(['a', 'b', 'c']);
const multiple = choiceNode(['a', 'b', 'c'], { multiple: true });

describe('readUserInput: texto', () => {
  it('{text: string}', () => expect(readUserInput(text, { text: 'Ana' })).toEqual({ kind: 'text', text: 'Ana' }));
  it('prototipo null aceptado', () => {
    expect(readUserInput(text, Object.assign(Object.create(null), { text: 'Ana' }))).toEqual({ kind: 'text', text: 'Ana' });
  });
  it.each([
    ['string', 'Ana'],
    ['text no string', { text: 5 }],
    ['propiedad extra', { text: 'Ana', extra: 1 }],
    ['choice', { choice: 'a' }],
    ['choices', { choices: ['a'] }],
    ['vacío', {}],
    ['null', null],
    ['undefined', undefined],
    ['array', ['Ana']],
    ['String objeto', { text: new String('Ana') }],
    ['instancia de clase', new (class X { text = 'Ana'; })()],
    ['Date', new Date()],
    ['número', 5],
  ])('%s → null', (_name, input) => expect(readUserInput(text, input)).toBeNull());

  it('clave símbolo extra o no enumerable extra → null', () => {
    expect(readUserInput(text, { text: 'Ana', [Symbol('x')]: 1 })).toBeNull();
    const hidden = { text: 'Ana' };
    Object.defineProperty(hidden, 'oculta', { value: 1, enumerable: false });
    expect(readUserInput(text, hidden)).toBeNull();
  });

  it('una sola clave símbolo → null', () => {
    expect(readUserInput(text, { [Symbol('text')]: 'Ana' })).toBeNull();
  });

  it('text anidado 100000 niveles → null sin recursar', () => {
    let x: unknown = 1;
    for (let i = 0; i < 100000; i++) x = [x];
    expect(readUserInput(text, { text: x })).toBeNull();
  });
});

describe('readUserInput: selección única', () => {
  it('{choice: id}', () => expect(readUserInput(single, { choice: 'b' })).toEqual({ kind: 'choice', option: 1 }));
  it.each([
    ['desconocido', { choice: 'z' }],
    ['no string', { choice: 1 }],
    ['text', { text: 'a' }],
    ['choices', { choices: ['a'] }],
    ['extra', { choice: 'a', x: 1 }],
    ['id con forma de Object.prototype', { choice: 'constructor' }],
    ['__proto__', { choice: '__proto__' }],
  ])('%s → null', (_name, input) => expect(readUserInput(single, input)).toBeNull());
});

describe('readUserInput: selección múltiple', () => {
  it('ordena por el orden del flujo', () => {
    expect(readUserInput(multiple, { choices: ['c', 'a'] })).toEqual({ kind: 'choices', options: [0, 2] });
  });
  it('vacío se lee como vacío', () => {
    expect(readUserInput(multiple, { choices: [] })).toEqual({ kind: 'choices', options: [] });
  });
  it.each([
    ['desconocido', { choices: ['a', 'z'] }],
    ['repetido', { choices: ['a', 'a'] }],
    ['no string', { choices: ['a', 1] }],
    ['string en vez de array', { choices: 'a' }],
    ['objeto tipo array', { choices: { 0: 'a', length: 1 } }],
    ['choice', { choice: 'a' }],
    ['hueco', { choices: ['a', , 'b'] }], // eslint-disable-line no-sparse-arrays
    ['más ids que opciones', { choices: ['a', 'b', 'c', 'a'] }],
    ['null', { choices: null }],
  ])('%s → null', (_name, input) => expect(readUserInput(multiple, input)).toBeNull());

  it('un Proxy de array pasa Array.isArray y se lee como un array', () => {
    expect(readUserInput(multiple, { choices: new Proxy(['b'], {}) })).toEqual({ kind: 'choices', options: [1] });
  });
});

describe('readTextInput (mensaje del usuario en un llm)', () => {
  it('{text: string} → el texto sin recortar', () => {
    expect(readTextInput({ text: '  Hola  ' })).toBe('  Hola  ');
    expect(readTextInput(Object.assign(Object.create(null), { text: 'Ana' }))).toBe('Ana');
  });

  it.each([
    ['string', 'Ana'],
    ['text no string', { text: 5 }],
    ['propiedad extra', { text: 'Ana', extra: 1 }],
    ['choice', { choice: 'a' }],
    ['choices', { choices: ['a'] }],
    ['vacío', {}],
    ['null', null],
    ['undefined', undefined],
    ['array', ['Ana']],
    ['String objeto', { text: new String('Ana') }],
    ['instancia de clase', new (class X { text = 'Ana'; })()],
    ['Date', new Date()],
    ['número', 5],
  ])('%s → null (las mismas formas que {text} de readUserInput)', (_name, input) => {
    expect(readTextInput(input)).toBeNull();
    expect(readUserInput(text, input)).toBeNull();
  });

  it('clave símbolo extra o no enumerable extra → null', () => {
    expect(readTextInput({ text: 'Ana', [Symbol('x')]: 1 })).toBeNull();
    const hidden = { text: 'Ana' };
    Object.defineProperty(hidden, 'oculta', { value: 1, enumerable: false });
    expect(readTextInput(hidden)).toBeNull();
    expect(readTextInput({ [Symbol('text')]: 'Ana' })).toBeNull();
  });

  it('text anidado 100000 niveles → null sin recursar', () => {
    let x: unknown = 1;
    for (let i = 0; i < 100000; i++) x = [x];
    expect(readTextInput({ text: x })).toBeNull();
  });
});
