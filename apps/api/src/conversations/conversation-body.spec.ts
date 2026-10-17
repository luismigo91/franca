import { describe, expect, it } from 'vitest';
import { ApiException } from '../http/api-error.js';
import { parseCreateBody, parseInputBody } from './conversation-body.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof ApiException ? error.code : 'otro';
  }
  return undefined;
};

describe('parseCreateBody', () => {
  it('solo flowId: version y contactId son null', () => {
    expect(parseCreateBody({ flowId: 'hola' })).toEqual({ flowId: 'hola', version: null, contactId: null });
  });

  it('todos los campos', () => {
    expect(parseCreateBody({ flowId: 'hola', version: 2, contactId: 'c-1' })).toEqual({ flowId: 'hola', version: 2, contactId: 'c-1' });
  });

  it('null equivale a omitido y las propiedades desconocidas se ignoran', () => {
    expect(parseCreateBody({ flowId: 'hola', version: null, contactId: null, canal: 'web', state: {} })).toEqual({ flowId: 'hola', version: null, contactId: null });
  });

  it.each([2147483647, 1])('admite version %d', (version) => {
    expect(parseCreateBody({ flowId: 'hola', version }).version).toBe(version);
  });

  it.each([
    [[]],
    [{}],
    [null],
    ['hola'],
    [5],
    [{ flowId: 5 }],
    [{ flowId: null }],
    [{ flowId: 'hola', version: '1' }],
    [{ flowId: 'hola', version: 0 }],
    [{ flowId: 'hola', version: -1 }],
    [{ flowId: 'hola', version: 1.5 }],
    [{ flowId: 'hola', version: 2147483648 }],
    [{ flowId: 'hola', version: true }],
    [{ flowId: 'hola', contactId: 7 }],
    [{ flowId: 'hola', contactId: '' }],
    [{ flowId: 'hola', contactId: 'ana@example.com' }],
    [{ flowId: 'hola', contactId: 'a'.repeat(65) }],
  ])('rechaza %j con invalid_request', (body) => {
    expect(codeOf(() => parseCreateBody(body))).toBe('invalid_request');
  });

  it('ignora un flowId heredado y no una propiedad propia llamada __proto__', () => {
    const inherited = Object.create({ flowId: 'hola' }) as unknown;
    expect(codeOf(() => parseCreateBody(inherited))).toBe('invalid_request');
    const withProto = JSON.parse('{"flowId":"hola","__proto__":{"flowId":"otro"}}') as unknown;
    expect(parseCreateBody(withProto).flowId).toBe('hola');
  });
});

describe('parseInputBody', () => {
  it.each([[{ text: 'Ana' }], [{ choice: 'a' }], [null], ['grande'], [5], [[]]])('devuelve input %j tal cual', (input) => {
    expect(parseInputBody({ input }).input).toBe(input);
  });

  it('ignora el resto del cuerpo, un state incluido', () => {
    expect(parseInputBody({ input: { text: 'x' }, state: { stateVersion: 1 }, otra: 1 })).toEqual({ input: { text: 'x' } });
  });

  it.each([[[]], [{}], [{ text: 'Ana' }], [null], ['x'], [5], [Object.create({ input: 1 })]])('rechaza %j con invalid_request', (body) => {
    expect(codeOf(() => parseInputBody(body))).toBe('invalid_request');
  });
});
