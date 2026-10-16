import { describe, expect, it } from 'vitest';
import { continueSession, MAX_RENDERED_LENGTH, startSession, type SessionState } from '../../src/index.js';
import {
  chainFlow,
  deepFreeze,
  end,
  flowOf,
  http,
  jump,
  message,
  messageTexts,
  setNode,
  start,
  startOk,
  variable,
  type Obj,
} from '../helpers/flows.js';

const L = MAX_RENDERED_LENGTH;
const big = (n: number, ch = 'y'): string => ch.repeat(n);
const withA = (nodes: Obj[], length = L, ch = 'y'): Obj =>
  flowOf(nodes, { variables: [variable('a', { default: big(length, ch) })] });

describe('Tamaño máximo: límites exactos en cada campo y nodo', () => {
  it.each([
    ['text', { kind: 'text', text: '{{a}}' }, { kind: 'text', text: '{{a}}!' }],
    ['url', { kind: 'image', url: '{{a}}' }, { kind: 'image', url: '{{a}}!' }],
    ['alt', { kind: 'video', url: 'u', alt: '{{a}}' }, { kind: 'video', url: 'u', alt: '{{a}}!' }],
  ])('end: %s admite 16384 y rechaza 16385 sin emitir message ni end', async (_campo, justo, pasado) => {
    const ok = await startOk(withA([{ id: 'fin', type: 'end', outcome: 'ok', content: [justo] }]));
    expect(ok.status).toBe('ended');
    expect(ok.events.map((e) => e.type)).toEqual(['message', 'end']);

    const ko = await startOk(withA([{ id: 'fin', type: 'end', outcome: 'ok', content: [pasado] }]));
    expect(ko.status).toBe('failed');
    expect(ko.events).toEqual([{ type: 'error', nodeId: 'fin', code: 'value_too_large', message: expect.any(String) }]);
    expect(ko.state).toMatchObject({ status: 'failed', outcome: null, error: { code: 'value_too_large', nodeId: 'fin' } });
  });

  it.each([
    ['text', { kind: 'text', text: '{{a}}!' }],
    ['url', { kind: 'audio', url: '{{a}}!' }],
    ['alt', { kind: 'embed', url: 'u', alt: '{{a}}!' }],
  ])('message: %s por encima del límite falla en el message y conserva los eventos anteriores', async (_c, pasado) => {
    const flow = withA([message('uno', 'antes', 'dos'), { id: 'dos', type: 'message', content: [pasado], next: 'fin' }, end('fin')]);
    const result = await startOk(flow);
    expect(result.events.map((e) => [e.type, e.nodeId])).toEqual([
      ['message', 'uno'],
      ['error', 'dos'],
    ]);
  });

  it('el límite es por texto, no por message: dos elementos de 16384 caben en el mismo evento', async () => {
    const flow = withA([
      { id: 'm', type: 'message', content: [{ kind: 'text', text: '{{a}}' }, { kind: 'text', text: '{{a}}' }], next: 'fin' },
      end('fin'),
    ]);
    const result = await startOk(flow);
    expect(result.status).toBe('ended');
    expect(messageTexts(result.events).map((t) => t.length)).toEqual([L, L]);
  });

  it('un fallo en el segundo elemento no emite el message aunque el primero fuera válido', async () => {
    const flow = withA([
      { id: 'm', type: 'message', content: [{ kind: 'text', text: 'hola' }, { kind: 'text', text: '{{a}}!' }], next: 'fin' },
      end('fin'),
    ]);
    const result = await startOk(flow);
    expect(result.events.map((e) => e.type)).toEqual(['error']);
  });

  it('cuenta unidades de código UTF-16: un emoji son dos', async () => {
    const ok = await startOk(withA([end('fin', { text: '{{a}}' })], L / 2, '😀'));
    expect(ok.status).toBe('ended');
    const ko = await startOk(withA([end('fin', { text: '{{a}}x' })], L / 2, '😀'));
    expect(ko.events).toEqual([{ type: 'error', nodeId: 'fin', code: 'value_too_large', message: expect.any(String) }]);
    const ko2 = await startOk(withA([end('fin', { text: '{{a}}😀' })], L - 1));
    expect(ko2.events[0]).toMatchObject({ type: 'error', code: 'value_too_large' });
  });

  it('un valor json cuya forma textual supera el límite falla al renderizarlo, no al guardarlo', async () => {
    const flow = flowOf([end('fin', { text: '{{a}}' })], { variables: [variable('a', { type: 'json', scope: 'contact' })] });
    const result = await startOk(flow, { a: { k: big(L) } });
    expect(result.events).toEqual([{ type: 'error', nodeId: 'fin', code: 'value_too_large', message: expect.any(String) }]);
    expect(result.state.contact.a).toEqual({ k: big(L) });
  });

  it('un número o booleano nunca supera el límite por sí solo, pero la suma de marcadores sí', async () => {
    const flow = flowOf(
      [end('fin', { text: Array.from({ length: L }, () => '{{n}}').join('') })],
      { variables: [variable('n', { type: 'number', default: 12 })] },
    );
    const result = await startOk(flow);
    expect(result.events[0]).toMatchObject({ type: 'error', code: 'value_too_large', nodeId: 'fin' });
  });

  it('set: un literal sin plantilla de más de 16384 también falla y no asigna', async () => {
    const flow = flowOf([setNode('s', [['b', 'ok'], ['a', big(L + 1)], ['c', 'no']], 'fin'), end('fin')], {
      variables: [variable('a'), variable('b'), variable('c')],
    });
    const result = await startOk(flow);
    expect(result.events.map((e) => [e.type, e.nodeId])).toEqual([['error', 's']]);
    expect(result.state.variables).toEqual({ b: 'ok' });
  });

  it('set: un literal de exactamente 16384 se guarda íntegro', async () => {
    const flow = flowOf([setNode('s', [['a', big(L)]], 'fin'), end('fin')], { variables: [variable('a')] });
    const result = await startOk(flow);
    expect(result.status).toBe('ended');
    expect(result.state.variables.a).toHaveLength(L);
  });

  it('set: renderizar un number como string respeta el límite y la asignación fallida no deja rastro', async () => {
    const flow = flowOf(
      [setNode('s', [['t', '{{big}}{{big}}']], 'fin'), end('fin')],
      { variables: [variable('t', { default: 'previo' }), variable('big', { default: big(L) })] },
    );
    const result = await startOk(flow);
    expect(result.status).toBe('failed');
    expect(result.state.variables.t).toBe('previo');
  });

  it('ni el evento error ni el estado de value_too_large incluyen el texto en ningún campo', async () => {
    const result = await startOk(withA([end('fin', { text: '{{a}}zz' })], L, 'q'));
    expect(JSON.stringify(result.events)).not.toContain('qq');
    expect(JSON.stringify(result.state.error)).not.toContain('qq');
  });
});

describe('Límite de 200 pasos: casos de borde', () => {
  it('199 saltos y un end con contenido: el end se ejecuta (nodo 200) y emite message y end', async () => {
    const result = await startOk(chainFlow(199, 'jump', end('fin', { outcome: 'ok', text: 'hola' })));
    expect(result.status).toBe('ended');
    expect(result.events.map((e) => e.type)).toEqual(['message', 'end']);
  });

  it('200 saltos y un end con contenido: falla en el end sin emitir su message ni su end', async () => {
    const result = await startOk(chainFlow(200, 'jump', end('fin', { outcome: 'ok', text: 'hola' })));
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'fin', code: 'step_limit_exceeded', message: expect.any(String) },
    ]);
    expect(result.state.outcome).toBeNull();
  });

  it('el message nodo 200 se emite y el nodo 201 es el que falla, conservando el evento', async () => {
    const nodes: Obj[] = [];
    for (let i = 0; i < 199; i++) nodes.push(jump(`n${i}`, i + 1 < 199 ? `n${i + 1}` : 'm'));
    nodes.push(message('m', 'hola', 'fin'), end('fin'));
    const result = await startOk(flowOf(nodes, { start: 'n0' }));
    expect(result.events.map((e) => [e.type, e.nodeId])).toEqual([
      ['message', 'm'],
      ['error', 'fin'],
    ]);
    expect(result.events[1]).toMatchObject({ code: 'step_limit_exceeded' });
  });

  it('las asignaciones del set nodo 200 constan y el nodo 201 falla', async () => {
    const flow = chainFlow(200, 'set', end('fin'));
    const result = await startOk(flow);
    expect(result.events).toHaveLength(1);
    expect(result.state.variables.x).toBe(199);
    expect(result.state.error).toEqual({ code: 'step_limit_exceeded', nodeId: 'fin' });
  });

  it('el límite gana también a value_too_large y a invalid_rule del nodo 201', async () => {
    const tooLarge = withA([...chainNodes(200, 'e'), end('e', { text: '{{a}}!' })]);
    const result = await startOk(tooLarge);
    expect(result.events[0]).toMatchObject({ code: 'step_limit_exceeded', nodeId: 'e' });
  });

  it('un nodo unsupported en el puesto 200 falla como unsupported_node; en el 201, como límite', async () => {
    const at200 = flowOf([...chainNodes(199, 'h'), http('h', 'f', 'f'), end('f')], { start: 'n0' });
    expect((await startOk(at200)).events[0]).toMatchObject({ code: 'unsupported_node', nodeId: 'h' });
    const at201 = flowOf([...chainNodes(200, 'h'), http('h', 'f', 'f'), end('f')], { start: 'n0' });
    expect((await startOk(at201)).events[0]).toMatchObject({ code: 'step_limit_exceeded', nodeId: 'h' });
  });
});

function chainNodes(count: number, last: string): Obj[] {
  return Array.from({ length: count }, (_, i) => jump(`n${i}`, i + 1 < count ? `n${i + 1}` : last));
}

describe('Valores de contacto: copias, claves ajenas y valores no JSON', () => {
  const contactFlow = () =>
    flowOf([end('fin')], {
      variables: [variable('v', { type: 'json', scope: 'contact' }), variable('s', { default: 'sesion' })],
    });

  it.each([
    ['undefined', undefined],
    ['símbolo', Symbol('x')],
    ['bigint', 1n],
    ['NaN anidado', { a: [1, { b: NaN }] }],
    ['-Infinity anidado', [[-Infinity]]],
    ['array disperso', [1, , 3]], // eslint-disable-line no-sparse-arrays
    ['Number envuelto', new Number(1)],
    ['String envuelto', new String('a')],
    ['Map', new Map()],
    ['Set', new Set()],
    ['RegExp', /a/],
    ['Date anidado', { d: new Date(0) }],
    ['función anidada', { f: () => 1 }],
    ['instancia de clase', new (class P {})()],
    ['subclase de Array', new (class A extends Array {})()],
    ['Uint8Array', new Uint8Array(1)],
    ['objeto con toJSON', { toJSON: () => 'x' }],
  ])('valor %s en una variable declarada → invalid_contact', async (_nombre, value) => {
    const result = await start(contactFlow(), { v: value });
    expect(result).toMatchObject({ ok: false, code: 'invalid_contact' });
    expect(result).not.toHaveProperty('events');
    expect(result).not.toHaveProperty('state');
  });

  it('el mismo valor no JSON en una clave ajena también se rechaza, sin nombrar la clave', async () => {
    const result = await start(contactFlow(), { 'secreto@example.com': NaN });
    expect(result).toMatchObject({ ok: false, code: 'invalid_contact' });
    expect(JSON.stringify(result)).not.toContain('secreto@example.com');
  });

  it('un ciclo anidado se rechaza', async () => {
    const ciclo: Record<string, unknown> = { a: [] };
    (ciclo.a as unknown[]).push(ciclo);
    expect(await start(contactFlow(), { v: ciclo })).toMatchObject({ ok: false, code: 'invalid_contact' });
  });

  it('la misma referencia repetida sin ciclo es válida', async () => {
    const compartido = { x: 1 };
    const result = await startOk(contactFlow(), { v: [compartido, compartido] });
    expect(result.state.contact.v).toEqual([{ x: 1 }, { x: 1 }]);
  });

  it.each([
    ['0', 0],
    ['false', false],
    ['string vacío', ''],
    ['string JSON', '{"v":1}'],
    ['array vacío', []],
    ['array de objetos', [{ v: 1 }]],
    ['función', () => 1],
    ['Date', new Date(0)],
    ['bigint', 1n],
  ])(
    'contacto %s que no es un objeto plano → invalid_contact',
    async (_nombre, contact) => {
      expect(await start(contactFlow(), contact)).toMatchObject({ ok: false, code: 'invalid_contact' });
    },
  );

  it('acepta un objeto sin prototipo y claves simbólicas, que se ignoran', async () => {
    const sinProto = Object.assign(Object.create(null) as object, { v: 'x' });
    expect((await startOk(contactFlow(), sinProto)).state.contact).toEqual({ v: 'x' });
    const result = await startOk(contactFlow(), { [Symbol('s')]: 1, v: 'y' });
    expect(result.state.contact).toEqual({ v: 'y' });
  });

  it('normaliza -0 a 0 en el estado', async () => {
    const result = await startOk(contactFlow(), { v: -0 });
    expect(Object.is(result.state.contact.v, 0)).toBe(true);
    expect(JSON.stringify(result.state)).toBe(JSON.stringify(JSON.parse(JSON.stringify(result.state))));
  });

  it('claves __proto__ del host no contaminan Object.prototype ni cambian el prototipo del estado', async () => {
    const hostil = JSON.parse('{"v":{"__proto__":{"polluted":"si"}},"__proto__":{"polluted2":"si"}}');
    const result = await startOk(contactFlow(), hostil);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    expect((result.state.contact as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result.state.contact)).toBe(Object.prototype);
    const back = JSON.parse(JSON.stringify(result.state)) as SessionState;
    expect(back).toEqual(result.state);
    expect(Object.hasOwn(back.contact.v as object, '__proto__')).toBe(true);
  });

  it('un valor inyectado a una variable de sesión o ajena no aparece en variables ni en contact', async () => {
    const result = await startOk(contactFlow(), { s: 'inyectado', ajena: 'x', v: 1 });
    expect(result.state.variables).toEqual({ s: 'sesion' });
    expect(result.state.contact).toEqual({ v: 1 });
  });

  it('no muta el objeto del host ni comparte referencias con el estado devuelto', async () => {
    const contact = { v: { lista: [1, { a: 'x' }] }, ajena: [1] };
    const antes = structuredClone(contact);
    const result = await startOk(contactFlow(), contact);
    expect(contact).toEqual(antes);
    (result.state.contact.v as { lista: unknown[] }).lista.push('mutado');
    expect(contact).toEqual(antes);
    expect(Object.isFrozen(contact)).toBe(false);
  });

  it('mutar el estado devuelto no afecta a otra sesión con el mismo flujo y contacto', async () => {
    const flow = flowOf([end('fin')], { variables: [variable('d', { type: 'json', default: { items: [1] } })] });
    const contact = { v: [1] };
    const a = await startOk(flow, contact);
    (a.state.variables.d as { items: number[] }).items.push(99);
    const b = await startOk(flow, contact);
    expect(b.state.variables.d).toEqual({ items: [1] });
    expect((flow.variables as Obj[])[0]!.default).toEqual({ items: [1] });
  });

  it('un contacto congelado en profundidad con estructuras anidadas funciona', async () => {
    const contact = deepFreeze({ v: { a: [1, 2, { b: null }] } });
    const result = await startOk(contactFlow(), contact);
    expect(result.state.contact.v).toEqual({ a: [1, 2, { b: null }] });
  });

  it('un valor null en una variable de sesión o ajena no cambia su default', async () => {
    const result = await startOk(contactFlow(), { s: null, v: null });
    expect(result.state.variables.s).toBe('sesion');
    expect(result.state.contact.v).toBeNull();
  });
});

describe('Flujo en memoria con valores no JSON: se ejecuta su forma JSON', () => {
  it('NaN, undefined y funciones dentro de un default json se normalizan igual que JSON.stringify', async () => {
    const flow = flowOf([end('fin', { text: '{{v}}' })], {
      variables: [{ name: 'v', type: 'json', default: { a: NaN, b: undefined, c: [undefined, Infinity, () => 1], d: -0 } }],
    });
    const result = await startOk(flow);
    expect(messageTexts(result.events)).toEqual(['{"a":null,"c":[null,null,null],"d":0}']);
    expect(result.state.variables.v).toEqual({ a: null, c: [null, null, null], d: 0 });
  });

  it('un default Date se ejecuta como su ISO string', async () => {
    const flow = flowOf([end('fin', { text: '{{v}}' })], {
      variables: [{ name: 'v', type: 'string', default: new Date(0) }],
    });
    expect(messageTexts((await startOk(flow)).events)).toEqual(['1970-01-01T00:00:00.000Z']);
  });

  it('toJSON se invoca una sola vez por operación y el flujo validado es el ejecutado', async () => {
    let llamadas = 0;
    const texto = {
      toJSON: () => {
        llamadas++;
        return `llamada-${llamadas}`;
      },
    };
    const flow = flowOf([{ id: 'fin', type: 'end', content: [{ kind: 'text', text: texto }] }]);
    const result = await startOk(flow);
    expect(llamadas).toBe(1);
    expect(messageTexts(result.events)).toEqual(['llamada-1']);
  });

  it('un set con NaN asigna null (la variable queda sin valor)', async () => {
    const flow = flowOf([setNode('s', [['v', NaN]], 'fin'), end('fin', { text: '[{{v}}]' })], {
      variables: [variable('v', { type: 'number', default: 5 })],
    });
    const result = await startOk(flow);
    expect(messageTexts(result.events)).toEqual(['[]']);
    expect(result.state.variables).toEqual({});
  });
});

describe('Continuar una sesión con estados manipulados', () => {
  const flow = () => flowOf([message('m', 'Hola', 'fin'), end('fin', { outcome: 'ok' })], { id: 'a' });
  const base = async (): Promise<SessionState> => (await startOk(flow())).state;
  const run = (state: unknown, f: unknown = flow()) => continueSession({ flow: f, state, input: 'x' });

  it('el flujo de otro id gana a la sesión inactiva: state_mismatch, no session_not_active', async () => {
    expect(await run({ ...(await base()), flowId: 'b' })).toMatchObject({ ok: false, code: 'state_mismatch' });
  });

  it('el nodo ausente gana a la sesión inactiva, también en un estado fallido', async () => {
    const failed = { ...(await base()), status: 'failed', outcome: null, error: { code: 'invalid_rule', nodeId: 'fin' } };
    expect(await run({ ...failed, nodeId: 'desaparecido' })).toMatchObject({ ok: false, code: 'state_mismatch' });
    expect(await run({ ...failed, nodeId: '' })).toMatchObject({ ok: false, code: 'state_mismatch' });
    expect(await run(failed)).toMatchObject({ ok: false, code: 'session_not_active' });
  });

  it('un estado mal formado de otro flujo se rechaza como invalid_state, no como state_mismatch', async () => {
    expect(await run({ ...(await base()), flowId: 'b', stateVersion: 2 })).toMatchObject({ code: 'invalid_state' });
    expect(await run({ ...(await base()), flowId: 'b', status: 'running' })).toMatchObject({ code: 'invalid_state' });
  });

  it('el flujo inválido gana a todo, incluido un estado de otro flujo', async () => {
    const roto = { ...flow(), start: undefined };
    expect(await run({ ...(await base()), flowId: 'b' }, roto)).toMatchObject({ code: 'invalid_flow' });
  });

  it.each([
    ['stateVersion como string', { stateVersion: '1' }],
    ['stateVersion 0', { stateVersion: 0 }],
    ['stateVersion negativa', { stateVersion: -1 }],
    ['stateVersion booleana', { stateVersion: true }],
    ['código de error ajeno a la sesión', { status: 'failed', outcome: null, error: { code: 'invalid_flow', nodeId: 'fin' } }],
    ['código de error de rechazo', { status: 'failed', outcome: null, error: { code: 'state_mismatch', nodeId: 'fin' } }],
    ['error sin nodeId', { status: 'failed', outcome: null, error: { code: 'invalid_rule' } }],
    ['error como array', { status: 'failed', outcome: null, error: [] }],
    ['outcome numérico', { outcome: 3 }],
    ['outcome objeto', { outcome: {} }],
    ['status ended con error', { error: { code: 'invalid_rule', nodeId: 'fin' } }],
    ['status failed sin error', { status: 'failed', outcome: null }],
    ['status failed con outcome', { status: 'failed', error: { code: 'invalid_rule', nodeId: 'fin' } }],
    ['variables como array', { variables: [] }],
    ['variables con null', { variables: { a: null } }],
    ['variables con undefined', { variables: { a: undefined } }],
    ['variables con NaN', { variables: { a: NaN } }],
    ['contact como string', { contact: '{}' }],
    ['contact con Date', { contact: { a: new Date(0) } }],
    ['nodeId numérico', { nodeId: 7 }],
    ['flowId ausente', { flowId: undefined }],
  ])('%s → invalid_state', async (_nombre, parche) => {
    expect(await run({ ...(await base()), ...parche })).toMatchObject({ ok: false, code: 'invalid_state' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['0', 0],
    ['string vacío', ''],
    ['string', 'estado'],
    ['array vacío', []],
    ['array con objeto', [{}]],
    ['función', () => 1],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['true', true],
  ])(
    'estado %s que no es un objeto → invalid_state',
    async (_nombre, state) => {
      expect(await run(state)).toMatchObject({ ok: false, code: 'invalid_state' });
    },
  );

  it('campos extra, claves __proto__ y un error con campos extra se aceptan y se ignoran', async () => {
    const hostil = JSON.parse(
      JSON.stringify({ ...(await base()), extra: { a: 1 } }).replace('{', '{"__proto__":{"status":"x","polluted":"si"},'),
    );
    expect(await run(hostil)).toMatchObject({ ok: false, code: 'session_not_active' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const conMensaje = { ...(await base()), status: 'failed', outcome: null, error: { code: 'invalid_rule', nodeId: 'fin', message: 'x' } };
    expect(await run(conMensaje)).toMatchObject({ code: 'session_not_active' });
  });

  it('acepta un estado con prototipo null y stateVersion 1.0', async () => {
    const sinProto = Object.assign(Object.create(null) as object, await base());
    expect(await run(sinProto)).toMatchObject({ code: 'session_not_active' });
    expect(await run({ ...(await base()), stateVersion: 1.0 })).toMatchObject({ code: 'session_not_active' });
  });

  it('un rechazo no modifica el estado ni el flujo recibidos (congelados) y no tiene events ni state', async () => {
    const estado = deepFreeze(structuredClone(await base()));
    const flujo = deepFreeze(structuredClone(flow()));
    const antesEstado = structuredClone(estado);
    for (const input of [undefined, null, 'hola', { a: 1 }, NaN, 5n]) {
      const result = await continueSession({ flow: flujo, state: estado, input });
      expect(result).toMatchObject({ ok: false, code: 'session_not_active' });
      expect(Object.keys(result).sort()).toEqual(['code', 'message', 'ok']);
    }
    expect(estado).toEqual(antesEstado);
  });

  it('la entrada del usuario no influye en la decisión y se puede omitir', async () => {
    const state = await base();
    expect(await continueSession({ flow: flow(), state } as never)).toMatchObject({ code: 'session_not_active' });
  });
});
