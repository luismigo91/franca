import { describe, expect, it } from 'vitest';
import { buildState, parseState } from '../../src/state.js';
import { VariableStore } from '../../src/variables.js';
import type { Flow } from '@franca/spec';

const ended = () => ({
  stateVersion: 1,
  flowId: 'f',
  status: 'ended',
  nodeId: 'fin',
  variables: { a: 'x', datos: { n: [1, 2] } },
  contact: { email: null, tel: '123' },
  outcome: 'listo',
  error: null,
});
const failed = () => ({
  ...ended(),
  status: 'failed',
  outcome: null,
  error: { code: 'unsupported_node', nodeId: 'fin' },
});

describe('parseState', () => {
  it('acepta un estado terminado y uno fallido, y devuelve una copia', () => {
    const input = ended();
    const parsed = parseState(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed?.variables).not.toBe(input.variables);
    expect(parseState(failed())).toEqual(failed());
  });

  it('acepta un estado terminado sin outcome', () => {
    expect(parseState({ ...ended(), outcome: null })).not.toBeNull();
  });

  it('{} y lo que no es un objeto → null', () => {
    for (const bad of [{}, null, undefined, 'estado', 3, [], [ended()]]) expect(parseState(bad)).toBeNull();
  });

  it('versión desconocida → null', () => {
    for (const v of [0, 2, '1', null, undefined]) expect(parseState({ ...ended(), stateVersion: v })).toBeNull();
  });

  it.each([
    ['flowId', 7],
    ['flowId', undefined],
    ['status', 'waiting'],
    ['status', 'running'],
    ['status', undefined],
    ['nodeId', null],
    ['nodeId', 3],
    ['variables', []],
    ['variables', null],
    ['variables', { a: null }],
    ['contact', []],
    ['contact', 'x'],
    ['outcome', 5],
    ['outcome', undefined],
    ['error', 'fallo'],
    ['error', undefined],
    ['error', { code: 'otro', nodeId: 'fin' }],
    ['error', { code: 'unsupported_node' }],
    ['error', { code: 'unsupported_node', nodeId: 3 }],
  ])('campo %s con valor %j → null', (field, value) => {
    expect(parseState({ ...failed(), [field]: value })).toBeNull();
    expect(parseState({ ...ended(), [field]: value })).toBeNull();
  });

  it('incoherencias status/outcome/error → null', () => {
    expect(parseState({ ...ended(), error: { code: 'invalid_rule', nodeId: 'fin' } })).toBeNull();
    expect(parseState({ ...failed(), error: null })).toBeNull();
    expect(parseState({ ...failed(), outcome: 'listo' })).toBeNull();
  });

  it('valores no JSON → null', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const bad of [NaN, Infinity, () => 1, new Date(0), 1n, undefined, cyclic]) {
      expect(parseState({ ...ended(), variables: { a: bad } })).toBeNull();
      expect(parseState({ ...ended(), contact: { a: bad } })).toBeNull();
    }
  });

  it('conserva __proto__ como variable', () => {
    const parsed = parseState({ ...ended(), variables: JSON.parse('{"__proto__":"x"}') });
    expect(Object.hasOwn(parsed!.variables, '__proto__')).toBe(true);
  });

  it('ignora propiedades desconocidas sin copiarlas', () => {
    expect(parseState({ ...ended(), extra: 1 })).not.toHaveProperty('extra');
  });
});

describe('buildState', () => {
  it('construye en orden de claves del contrato y sin referencias compartidas', () => {
    const flow = { id: 'f' } as Flow;
    const store = new VariableStore([
      { name: 'a', type: 'string' },
      { name: 'e', type: 'string', scope: 'contact' },
    ]);
    const datos = { n: 1 };
    store.set('a', datos);
    const state = buildState(flow, store, { status: 'ended', nodeId: 'fin', outcome: null, error: null });
    expect(Object.keys(state)).toEqual(['stateVersion', 'flowId', 'status', 'nodeId', 'variables', 'contact', 'outcome', 'error']);
    expect(state.variables.a).toEqual(datos);
    expect(state.variables.a).not.toBe(datos);
    expect(state.contact).toEqual({ e: null });
  });
});
