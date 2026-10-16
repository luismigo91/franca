import { createLlmCapability, startSession, type SessionResult } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../../src/index.js';
import { fakeApi, okMessage, slot, turnRequest, type ApiStep } from '../helpers/fake-api.js';

/**
 * QA independiente: la salida del modelo es hostil. Se lee con el SDK real y un `fetch` falso, y
 * también a través del motor, que es quien decide. Los escapes `\uXXXX` evitan caracteres
 * invisibles en el fichero.
 */

const COST = 0.006;
const message = (content: unknown, overrides: Record<string, unknown> = {}) => ({ ...okMessage({}), content, ...overrides });
const textBlock = (text: string) => ({ type: 'text', text });
const outputText = (output: unknown): string => JSON.stringify(output);
const convert = async (body: unknown, request = turnRequest()) => {
  const api = fakeApi([{ body } as ApiStep]);
  return createAnthropicProvider({ client: api.client() })(request);
};
const VALID = { text: 'Hola', done: false, slots: { s0: null, s1: null } };

describe('Salida estructurada hostil: el proveedor resuelve failed con coste, nunca lanza', () => {
  const cost = expect.closeTo(COST, 10);
  const broken: [string, string][] = [
    ['vacía', ''],
    ['solo espacios', '   '],
    ['con BOM', `﻿${outputText(VALID)}`],
    ['con valla de markdown', `\`\`\`json\n${outputText(VALID)}\n\`\`\``],
    ['con texto antes', `Claro: ${outputText(VALID)}`],
    ['con texto después', `${outputText(VALID)} gracias`],
    ['con coma final', '{"text":"Hola","done":false,"slots":{"s0":null,"s1":null},}'],
    ['con comentario', '{"text":"Hola"/*x*/,"done":false,"slots":{"s0":null,"s1":null}}'],
    ['con comillas simples', "{'text':'Hola','done':false,'slots':{'s0':null,'s1':null}}"],
    ['con NaN', '{"text":"Hola","done":NaN,"slots":{"s0":null,"s1":null}}'],
    ['un array', '[]'],
    ['un string', '"Hola"'],
    ['null', 'null'],
    ['un número', '5'],
    ['sin text', outputText({ done: false, slots: { s0: null, s1: null } })],
    ['sin done', outputText({ text: 'Hola', slots: { s0: null, s1: null } })],
    ['sin slots', outputText({ text: 'Hola', done: false })],
    ['slots que falta una clave', outputText({ text: 'Hola', done: false, slots: { s0: null } })],
    ['slots null', outputText({ text: 'Hola', done: false, slots: null })],
    ['slots array', outputText({ text: 'Hola', done: false, slots: [null, null] })],
    ['text no string', outputText({ text: 5, done: false, slots: { s0: null, s1: null } })],
    ['text null', outputText({ text: null, done: false, slots: { s0: null, s1: null } })],
    ['done como string', outputText({ text: 'Hola', done: 'true', slots: { s0: null, s1: null } })],
    ['done como número', outputText({ text: 'Hola', done: 1, slots: { s0: null, s1: null } })],
    ['done null', outputText({ text: 'Hola', done: null, slots: { s0: null, s1: null } })],
    ['boolean donde va un string', outputText({ text: 'Hola', done: false, slots: { s0: null, s1: true } })],
    ['string donde va un boolean', outputText({ text: 'Hola', done: false, slots: { s0: 'true', s1: null } })],
    ['número donde va un boolean', outputText({ text: 'Hola', done: false, slots: { s0: 1, s1: null } })],
    ['objeto donde va un string', outputText({ text: 'Hola', done: false, slots: { s0: null, s1: { a: 1 } } })],
    ['array donde va un string', outputText({ text: 'Hola', done: false, slots: { s0: null, s1: ['x'] } })],
    ['undefined serializado como clave ausente', '{"text":"Hola","done":false,"slots":{"s1":null}}'],
  ];

  it.each(broken)('%s', async (_label, text) => {
    const result = await convert(message([textBlock(text)]));
    expect(result).toEqual({ kind: 'failed', costUsd: cost });
  });

  it.each([
    ['content no es un array', 'texto'],
    ['content null', null],
    ['content vacío', []],
    ['solo pensamiento', [{ type: 'thinking', thinking: 'x', signature: 'y' }]],
    ['solo redacted_thinking', [{ type: 'redacted_thinking', data: 'x' }]],
    ['solo tool_use', [{ type: 'tool_use', id: 't', name: 'n', input: {} }]],
    ['bloque text sin texto', [{ type: 'text' }]],
    ['bloque text con texto no string', [{ type: 'text', text: 5 }]],
    ['bloques null', [null, 5, 'x']],
    ['fallback al final', [textBlock(outputText(VALID)), { type: 'fallback', from_model: 'a', to_model: 'b', reason: 'refusal' }]],
    ['el texto válido va antes del último fallback', [textBlock(outputText(VALID)), { type: 'fallback' }, textBlock('')]],
  ])('contenido: %s', async (_label, content) => {
    const result = await convert(message(content));
    expect(result).toEqual({ kind: 'failed', costUsd: cost });
  });

  it('el texto se une entre bloques, ignorando pensamientos y herramientas intercalados', async () => {
    const full = outputText({ text: 'Hola mundo', done: true, slots: { s0: true, s1: 'motivo' } });
    // Los cortes caen dentro de strings: unir con cualquier separador cambiaría el valor.
    const first = full.indexOf('mundo') + 2;
    const second = full.indexOf('motivo') + 3;
    const result = await convert(message([textBlock(full.slice(0, first)), { type: 'thinking', thinking: 'MARCA-PENSAMIENTO', signature: 's' }, textBlock(full.slice(first, second)), { type: 'tool_use', id: 't', name: 'n', input: { x: 'MARCA-TOOL' } }, textBlock(full.slice(second))]));
    expect(result).toEqual({ kind: 'turn', text: 'Hola mundo', done: true, slots: { resuelto: true, motivo: 'motivo' }, costUsd: cost });
    expect(JSON.stringify(result)).not.toContain('MARCA');
  });

  it('un JSON profundísimo en un campo que no se lee no revienta ni cambia el resultado', async () => {
    const deep = `{"text":"Hola","done":false,"slots":{"s0":null,"s1":null},"x":${'['.repeat(50000)}${']'.repeat(50000)}}`;
    const result = await convert(message([textBlock(deep)]));
    // O es un turno (se ignora lo que sobra) o failed (V8 no lo parsea): nunca una excepción ni datos del campo.
    expect(['turn', 'failed']).toContain(result.kind);
    expect(JSON.stringify(result).length).toBeLessThan(200);
  });
});

describe('Tipos de los slots numéricos y booleanos: sin coerción', () => {
  const request = () => turnRequest({ slots: [slot('n', 'number'), slot('ok', 'boolean'), slot('t', 'string')] });
  const out = (s0: unknown, s1: unknown = null, s2: unknown = null) => message([textBlock(outputText({ text: 'Hola', done: false, slots: { s0, s1, s2 } }))]);

  it.each([
    ['number como string', out('12')],
    ['number como boolean', out(true)],
    ['number como array', out([12])],
    ['boolean como string', out(null, 'false')],
    ['boolean como número', out(null, 0)],
    ['string como número', out(null, null, 5)],
    ['string como boolean', out(null, null, false)],
  ])('%s: failed con coste', async (_label, body) => {
    expect(await convert(body, request())).toEqual({ kind: 'failed', costUsd: expect.closeTo(COST, 10) });
  });

  it('los tipos correctos pasan tal cual, incluidos los límites de number', async () => {
    for (const n of [0, 1.5, -2, 1e21, 5e-324, 123456789012345]) {
      const result = await convert(out(n, false, 'x'), request());
      expect(result, String(n)).toMatchObject({ kind: 'turn', slots: { n, ok: false, t: 'x' } });
    }
  });
});

describe('Claves de más en una salida válida: se descartan y no llegan al resultado', () => {
  it('claves de más en la raíz y en slots, incluidas __proto__ y constructor', async () => {
    const raw = '{"text":"Hola","done":true,"admin":true,"__proto__":{"polluted":1},"slots":{"s0":true,"s1":"m","s2":"EXTRA","__proto__":{"x":1},"constructor":"y","resuelto":false,"motivo":"OTRO"},"constructor":{"prototype":{"p":1}}}';
    const result = await convert(message([textBlock(raw)]));
    expect(result).toEqual({ kind: 'turn', text: 'Hola', done: true, slots: { resuelto: true, motivo: 'm' }, costUsd: expect.closeTo(COST, 10) });
    expect(JSON.stringify(result)).not.toMatch(/EXTRA|OTRO|admin|polluted/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('claves duplicadas: gana la última, como JSON.parse', async () => {
    const raw = '{"text":"uno","text":"dos","done":false,"slots":{"s0":false,"s0":true,"s1":null}}';
    expect(await convert(message([textBlock(raw)]))).toMatchObject({ kind: 'turn', text: 'dos', slots: { resuelto: true } });
  });

  it('el resultado no comparte referencias con la respuesta: cada turno devuelve un objeto nuevo', async () => {
    const api = fakeApi([{ body: okMessage({ text: 'Hola' }) }]);
    const provider = createAnthropicProvider({ client: api.client() });
    const [a, b] = [await provider(turnRequest()), await provider(turnRequest())];
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    if (a.kind === 'turn' && b.kind === 'turn') expect(a.slots).not.toBe(b.slots);
  });
});

describe('Slots de la salida: lo que el proveedor entrega y lo que el motor recoge', () => {
  const jsonRequest = () => turnRequest({ slots: [slot('datos', 'json'), slot('n', 'number'), slot('ok', 'boolean')] });
  const out = (s0: unknown, s1: unknown = null, s2: unknown = null) => message([textBlock(outputText({ text: 'Hola', done: false, slots: { s0, s1, s2 } }))]);

  it.each([
    ['objeto', '{"a":[1,{"b":null}]}', { a: [1, { b: null }] }],
    ['array', '[1,2,3]', [1, 2, 3]],
    ['string', '"texto"', 'texto'],
    ['número', '12.5', 12.5],
    ['boolean false', 'false', false],
    ['cero', '0', 0],
    ['string vacío', '""', ''],
    ['con espacios alrededor', '  {"a":1}  ', { a: 1 }],
  ])('slot json %s', async (_label, text, value) => {
    const result = await convert(out(text), jsonRequest());
    expect(result).toMatchObject({ kind: 'turn', slots: { datos: value } });
  });

  it.each([
    ['null', 'null'],
    ['no es JSON', '{no es json'],
    ['vacío', ''],
    ['solo espacios', '  '],
    ['undefined', 'undefined'],
    ['NaN', 'NaN'],
  ])('slot json que %s no se incluye', async (_label, text) => {
    const result = await convert(out(text), jsonRequest());
    expect(result.kind).toBe('turn');
    expect((result as { slots: object }).slots).toEqual({});
  });

  it('un slot json con 1e999 llega como Infinity y el motor no lo recoge', async () => {
    const result = await convert(out('1e999'), jsonRequest());
    expect(result).toMatchObject({ kind: 'turn' });
    expect((result as { slots: Record<string, unknown> }).slots.datos).toBe(Infinity);
  });

  it('un slot json con __proto__ propio llega como propiedad propia y no contamina', async () => {
    const result = await convert(out('{"__proto__":{"polluted":1},"a":1}'), jsonRequest());
    const datos = (result as unknown as { slots: { datos: Record<string, unknown> } }).slots.datos;
    expect(Object.hasOwn(datos, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(datos)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('un slot json de 100 000 niveles no revienta el proveedor', async () => {
    const result = await convert(out(`${'['.repeat(100000)}${']'.repeat(100000)}`), jsonRequest());
    expect(['turn', 'failed']).toContain(result.kind);
  });
});

describe('A través del motor: un modelo hostil no puede saltarse nada', () => {
  const flow = {
    specVersion: '0.1',
    id: 'llm-email',
    name: 'Email con llm',
    variables: [
      { name: 'email', type: 'email', scope: 'contact', pii: true },
      { name: 'nota', type: 'string' },
      { name: 'datos', type: 'json' },
    ],
    start: 'a',
    nodes: [
      {
        id: 'a',
        type: 'llm',
        provider: 'principal',
        goal: 'Consigue el email del usuario.',
        slots: [{ variable: 'email', description: 'Email' }, { variable: 'nota', description: 'Nota', required: false }, { variable: 'datos', description: 'Datos', required: false }],
        maxTurns: 3,
        next: 'ok',
        onExhausted: 'ko',
      },
      { id: 'ok', type: 'end', outcome: 'ok' },
      { id: 'ko', type: 'end', outcome: 'ko' },
    ],
  };
  const run = async (output: unknown, usage?: Record<string, unknown>): Promise<SessionResult> => {
    const body = message([textBlock(typeof output === 'string' ? output : outputText(output))], usage ? { usage } : {});
    const api = fakeApi([{ body }]);
    const llm = createLlmCapability({ principal: createAnthropicProvider({ client: api.client() }) });
    const result = await startSession({ flow }, { llm });
    expect(result.ok).toBe(true);
    return result as SessionResult;
  };
  const slots = (s0: unknown, s1: unknown = null, s2: unknown = null) => ({ s0, s1, s2 });

  it('done sin el obligatorio no termina el nodo', async () => {
    const result = await run({ text: 'Listo', done: true, slots: slots(null, 'una nota') });
    expect(result.status).toBe('waiting');
    expect(result.state.conversation!.collected).toEqual({ nota: 'una nota' });
  });

  it('done con el email inválido tampoco', async () => {
    const result = await run({ text: 'Listo', done: true, slots: slots('ana@', 'n') });
    expect(result.status).toBe('waiting');
    expect(result.state.contact.email).toBeNull();
  });

  it('done con el email válido termina en ok y guarda los slots', async () => {
    const result = await run({ text: 'Gracias', done: true, slots: slots(' Ana@Example.com ', 'n', '{"a":[1]}') });
    expect(result.status).toBe('ended');
    expect(result.state.contact.email).toBe('Ana@example.com');
    expect(result.state.variables).toEqual({ nota: 'n', datos: { a: [1] } });
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['4097 caracteres', 'a'.repeat(4097)],
    ['U+0000', 'MARCA-TEXTO\u0000'],
    ['sustituto suelto', 'MARCA-TEXTO\ud800'],
  ])('texto del asistente %s: sale por invalid_turn y el coste cuenta', async (_label, text) => {
    const result = await run({ text, done: true, slots: slots('ana@example.com') });
    expect(result.events.map((e) => e.type)).toEqual(['llm', 'end']);
    expect(result.events[0]).toMatchObject({ type: 'llm', turns: 1, reason: 'invalid_turn', costUsd: expect.closeTo(COST, 10) });
    expect(result.state.contact.email).toBeNull();
    expect(JSON.stringify(result)).not.toContain('MARCA-TEXTO');
  });

  it.each([
    ['1e999 (Infinity)', '1e999'],
    ['100 000 niveles', `${'['.repeat(100000)}${']'.repeat(100000)}`],
    ['un objeto de 5000 caracteres', JSON.stringify({ a: 'x'.repeat(5000) })],
  ])('un slot json que el motor no puede guardar (%s) no se recoge y la sesión sigue', async (_label, text) => {
    const result = await run({ text: 'Hola', done: true, slots: slots('ana@example.com', null, text) });
    // El email válido y `done` bastan para terminar, pero el json inválido no llega a las variables.
    expect(result.status).toBe('ended');
    expect(result.state.variables.datos).toBeUndefined();
    expect(result.state.contact.email).toBe('ana@example.com');
  });

  it('una plantilla en el texto del asistente se emite literal', async () => {
    const result = await run({ text: 'Tu email es {{email}} y {{nota}}', done: false, slots: slots(null) });
    expect(result.events[0]).toMatchObject({ type: 'message', content: [{ kind: 'text', text: 'Tu email es {{email}} y {{nota}}' }] });
  });

  it('un rechazo del modelo cuenta el turno y su coste y sale por onExhausted', async () => {
    const body = { ...okMessage({}), stop_reason: 'refusal', content: [textBlock('parcial MARCA-RECHAZO')], stop_details: { category: 'MARCA-CATEGORIA' } };
    const api = fakeApi([{ body }]);
    const llm = createLlmCapability({ principal: createAnthropicProvider({ client: api.client() }) });
    const result = (await startSession({ flow }, { llm })) as SessionResult;
    expect(result.events.map((e) => e.type)).toEqual(['llm', 'end']);
    expect(result.events[0]).toMatchObject({ reason: 'refusal', turns: 1 });
    expect(JSON.stringify(result)).not.toContain('MARCA');
  });

  it('un uso enorme llega al motor como un coste finito y el tope de coste lo corta', async () => {
    const hugeFlow = { ...flow, nodes: flow.nodes.map((n) => (n.id === 'a' ? { ...n, costCapUsd: 1 } : n)) };
    const body = message([textBlock(outputText({ text: 'Hola', done: false, slots: slots(null) }))], { usage: { input_tokens: 9_007_199_254_740_991, output_tokens: 9_007_199_254_740_991 } });
    const api = fakeApi([{ body }]);
    const llm = createLlmCapability({ principal: createAnthropicProvider({ client: api.client() }) });
    const result = (await startSession({ flow: hugeFlow }, { llm })) as SessionResult;
    expect(result.events.at(-2)).toMatchObject({ type: 'llm', reason: 'cost_cap' });
    expect(Number.isFinite((result.events.at(-2) as { costUsd: number }).costUsd)).toBe(true);
  });
});
