import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildState, parseState } from '../../src/state.js';
import { VariableStore } from '../../src/variables.js';
import type { Flow } from '@franca/spec';
import { Conversation } from '../../src/llm/conversation.js';

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

const waiting = () => ({ ...ended(), status: 'waiting', outcome: null, error: null, attempt: 2 });

describe('parseState: estado en espera', () => {
  it('acepta un estado en espera y conserva attempt', () => {
    expect(parseState(waiting())).toEqual(waiting());
    expect(parseState({ ...waiting(), attempt: 11 })).toHaveProperty('attempt', 11);
  });

  it.each([0, -1, 1.5, '2', null, undefined, NaN, true, [1]])('attempt %j → null', (attempt) => {
    expect(parseState({ ...waiting(), attempt })).toBeNull();
  });

  it('waiting con error u outcome → null', () => {
    expect(parseState({ ...waiting(), error: { code: 'invalid_rule', nodeId: 'fin' } })).toBeNull();
    expect(parseState({ ...waiting(), outcome: 'listo' })).toBeNull();
  });

  it('ended y failed ignoran attempt y no lo devuelven', () => {
    expect(parseState({ ...ended(), attempt: 3 })).not.toHaveProperty('attempt');
    expect(parseState({ ...failed(), attempt: 'x' })).not.toHaveProperty('attempt');
  });

  it('el estado de la versión anterior se acepta tal cual', () => {
    const legacy = JSON.parse(readFileSync(new URL('../legacy/estado-v1-captacion-leads.json', import.meta.url), 'utf8'));
    expect(parseState(legacy)).toEqual(legacy);
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

describe('buildState: attempt', () => {
  const flow = { id: 'f' } as Flow;
  const store = new VariableStore([]);

  it('escribe attempt al final solo si se pide', () => {
    const w = buildState(flow, store, { status: 'waiting', nodeId: 'p', outcome: null, error: null, attempt: 2 });
    expect(Object.keys(w).at(-1)).toBe('attempt');
    expect(w.attempt).toBe(2);
    const e = buildState(flow, store, { status: 'ended', nodeId: 'p', outcome: null, error: null });
    expect(e).not.toHaveProperty('attempt');
  });
});

describe('parseState: profundidad por campo (D13)', () => {
  const chain = (levels: number): unknown => {
    let value: unknown = 1;
    for (let i = 0; i < levels; i++) value = [value];
    return value;
  };

  it.each(['contact', 'variables'] as const)('%s: profundidad 1000 aceptada y 1001 rechazada', (field) => {
    // el campo es un objeto (1) con un valor de 999 niveles: profundidad 1000
    expect(parseState({ ...ended(), [field]: { v: chain(999) } })).not.toBeNull();
    expect(parseState({ ...ended(), [field]: { v: chain(1000) } })).toBeNull();
  });

  it('un campo extra de 100000 niveles se rechaza sin lanzar', () => {
    expect(parseState({ ...ended(), extra: chain(100000) })).toBeNull();
  });

  it('el propio objeto del estado no cuenta', () => {
    expect(parseState({ ...ended(), contact: { v: chain(999) }, variables: { w: chain(999) } })).not.toBeNull();
  });
});

const conversation = () => ({
  messages: [
    { role: 'assistant', text: '¿Me das tu email?' },
    { role: 'user', text: 'Hola' },
    { role: 'assistant', text: '¿Cuál es?' },
  ],
  costUsd: 0.02,
  collected: { email: 'ana@example.com' },
});
const waitingLlm = () => ({ ...waiting(), attempt: 1, conversation: conversation() });
/** Mensajes que alternan empezando y terminando por el asistente. */
const alternating = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ role: i % 2 === 0 ? 'assistant' : 'user', text: `m${i}` }));

describe('parseState: conversación de un llm', () => {
  it('acepta una espera con conversación y la devuelve como copia, tras attempt', () => {
    const input = waitingLlm();
    const parsed = parseState(input);
    expect(parsed).toEqual(input);
    expect(parsed?.conversation).not.toBe(input.conversation);
    expect(parsed?.conversation?.messages).not.toBe(input.conversation.messages);
    expect(Object.keys(parsed!).at(-1)).toBe('conversation');
  });

  it('99 mensajes se aceptan y 101 se rechazan; 100 (par) también', () => {
    expect(parseState({ ...waitingLlm(), conversation: { ...conversation(), messages: alternating(99) } })).not.toBeNull();
    expect(parseState({ ...waitingLlm(), conversation: { ...conversation(), messages: alternating(101) } })).toBeNull();
    expect(parseState({ ...waitingLlm(), conversation: { ...conversation(), messages: alternating(100) } })).toBeNull();
  });

  it('una sola entrada del asistente es una conversación válida', () => {
    expect(parseState({ ...waitingLlm(), conversation: { ...conversation(), messages: alternating(1) } })).not.toBeNull();
  });

  it.each([
    ['sin mensajes', { messages: [] }],
    ['el último es del usuario', { messages: alternating(2) }],
    ['empieza por el usuario', { messages: alternating(3).map((m) => ({ ...m, role: m.role === 'user' ? 'assistant' : 'user' })) }],
    ['dos del asistente seguidos', { messages: [{ role: 'assistant', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'assistant', text: 'c' }] }],
    ['rol desconocido', { messages: [{ role: 'system', text: 'a' }] }],
    ['texto vacío', { messages: [{ role: 'assistant', text: '' }] }],
    ['texto de 4097', { messages: [{ role: 'assistant', text: 'a'.repeat(4097) }] }],
    ['texto con U+0000', { messages: [{ role: 'assistant', text: 'a\u0000' }] }],
    ['sustituto suelto', { messages: [{ role: 'assistant', text: 'a\ud800' }] }],
    ['texto no string', { messages: [{ role: 'assistant', text: 5 }] }],
    ['mensaje no objeto', { messages: ['hola'] }],
    ['mensajes no array', { messages: { 0: { role: 'assistant', text: 'a' }, length: 1 } }],
    ['coste -1', { costUsd: -1 }],
    ['coste "0.01"', { costUsd: '0.01' }],
    ['coste ausente', { costUsd: undefined }],
    ['collected con null', { collected: { email: null } }],
    ['collected array', { collected: [] }],
    ['collected ausente', { collected: undefined }],
  ])('conversación corrupta (%s) → null', (_name, patch) => {
    expect(parseState({ ...waitingLlm(), conversation: { ...conversation(), ...patch } })).toBeNull();
  });

  it('un texto de 4096 se acepta', () => {
    const messages = [{ role: 'assistant', text: 'a'.repeat(4096) }];
    expect(parseState({ ...waitingLlm(), conversation: { ...conversation(), messages } })).not.toBeNull();
  });

  it('coste NaN o infinito (no son JSON) → null', () => {
    for (const costUsd of [NaN, Infinity, -Infinity]) {
      expect(parseState({ ...waitingLlm(), conversation: { ...conversation(), costUsd } })).toBeNull();
    }
  });

  it('conversation: null es un estado corrupto, no «sin conversación»', () => {
    expect(parseState({ ...waitingLlm(), conversation: null })).toBeNull();
    expect(parseState({ ...waiting(), conversation: null })).toBeNull();
  });

  it.each([undefined, 'x', 3, [], true])('conversation %j → null', (value) => {
    expect(parseState({ ...waitingLlm(), conversation: value })).toBeNull();
  });

  it('una conversación en ended o en failed → null', () => {
    expect(parseState({ ...ended(), conversation: conversation() })).toBeNull();
    expect(parseState({ ...failed(), conversation: conversation() })).toBeNull();
  });

  it('collected conserva __proto__ como propiedad propia y valores no string', () => {
    const collected = JSON.parse('{"__proto__": "p", "n": 3.5, "ok": false, "datos": {"a": [1]}}');
    const parsed = parseState({ ...waitingLlm(), conversation: { ...conversation(), collected } });
    expect(Object.hasOwn(parsed!.conversation!.collected, '__proto__')).toBe(true);
    expect(parsed!.conversation!.collected).toEqual(collected);
  });

  it('ignora las propiedades extra de un mensaje y de la conversación', () => {
    const messages = [{ role: 'assistant', text: 'a', extra: 1 }];
    const parsed = parseState({ ...waitingLlm(), conversation: { ...conversation(), messages, extra: 2 } });
    expect(parsed!.conversation).toEqual({ messages: [{ role: 'assistant', text: 'a' }], costUsd: 0.02, collected: { email: 'ana@example.com' } });
  });

  it('un valor json de 100 niveles recogido pasa por JSON y se acepta', () => {
    let datos: unknown = 1;
    for (let i = 0; i < 100; i++) datos = [datos];
    const state = JSON.parse(JSON.stringify({ ...waitingLlm(), conversation: { ...conversation(), collected: { datos } } }));
    expect(parseState(state)).not.toBeNull();
  });
});

describe('buildState: conversación', () => {
  const flow = { id: 'f' } as Flow;
  const store = new VariableStore([]);

  it('escribe conversation al final solo si se da, como JSON independiente', () => {
    const conv = Conversation.empty();
    conv.pushAssistant('hola');
    conv.addTurn(0.01);
    conv.collect(new Map([['__proto__', 'p']]));
    const state = buildState(flow, store, { status: 'waiting', nodeId: 'a', outcome: null, error: null, attempt: 1, conversation: conv });
    expect(Object.keys(state).slice(-2)).toEqual(['attempt', 'conversation']);
    expect(state.conversation).toEqual({ messages: [{ role: 'assistant', text: 'hola' }], costUsd: 0.01, collected: JSON.parse('{"__proto__":"p"}') });
    expect(Object.hasOwn(state.conversation!.collected, '__proto__')).toBe(true);
    expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    const other = buildState(flow, store, { status: 'waiting', nodeId: 'p', outcome: null, error: null, attempt: 1 });
    expect(other).not.toHaveProperty('conversation');
  });
});
