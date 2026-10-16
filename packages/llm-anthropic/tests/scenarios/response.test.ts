import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../../src/index.js';
import { fakeApi, fixture, okMessage, slot, turnRequest } from '../helpers/fake-api.js';

/** Convierte una respuesta de la API (cuerpo completo) en el resultado del turno. */
async function convert(body: Record<string, unknown>, request = turnRequest()) {
  return createAnthropicProvider({ client: fakeApi([{ body }]).client() })(request);
}

const withContent = (content: unknown[], overrides: Record<string, unknown> = {}) => ({ ...fixture('message-end-turn'), content, ...overrides });
const textBlock = (value: unknown) => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });
const COST = 0.006; // 1000 de entrada y 100 de salida de Opus 5.5

describe('Lectura de la salida estructurada', () => {
  it('Turno con slots', async () => {
    const message = okMessage({ text: '¡Perfecto!', done: true, slots: { s0: true, s1: null } });
    const result = await convert(message);
    expect(result).toEqual({ kind: 'turn', text: '¡Perfecto!', slots: { resuelto: true }, done: true, costUsd: expect.closeTo(COST, 12) });
    expect(Object.keys((result as { slots: object }).slots)).toEqual(['resuelto']);
  });

  it('Slot sin valor', async () => {
    const request = turnRequest({ slots: [slot('motivo', 'string')] });
    const body = okMessage({ text: 'Hecho', done: true, slots: { s0: { found: false, value: 'MARCA-IGNORADO' } } });
    const result = (await convert(body, request)) as { kind: string; slots: object };
    expect(result.kind).toBe('turn');
    expect(result.slots).toEqual({});
    expect(JSON.stringify(result)).not.toContain('MARCA-IGNORADO');
  });

  it('Slots con nombre de Object', async () => {
    const request = turnRequest({ slots: [slot('__proto__', 'string'), slot('constructor', 'string')] });
    const result = (await convert(okMessage({ text: 'Hecho', done: true, slots: { s0: 'p', s1: 'c' } }), request)) as { slots: Record<string, unknown> };
    expect(Object.hasOwn(result.slots, '__proto__')).toBe(true);
    expect(Object.hasOwn(result.slots, 'constructor')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result.slots, '__proto__')?.value).toBe('p');
    expect(result.slots.constructor).toBe('c');
    expect(Object.getPrototypeOf(result.slots)).toBe(Object.prototype);
  });

  it('Salida tras un bloque de fallback', async () => {
    const result = await convert(fixture('message-fallback'), turnRequest({ model: 'claude-opus-5-5' }));
    expect(result).toMatchObject({ kind: 'turn', text: 'Hola', done: false });
  });

  it('Slot json', async () => {
    const request = turnRequest({ slots: [slot('datos', 'json')] });
    const valid = await convert(okMessage({ text: 'Hecho', done: true, slots: { s0: '{"a": [1]}' } }), request);
    expect(valid).toMatchObject({ kind: 'turn', slots: { datos: { a: [1] } } });
    const invalid = (await convert(okMessage({ text: 'Hecho', done: true, slots: { s0: '{no es json' } }), request)) as { slots: object };
    expect(invalid).toMatchObject({ kind: 'turn' });
    expect(invalid.slots).toEqual({});
  });

  it('un slot json con el texto null, y los slots number y boolean, se tratan como valores', async () => {
    const request = turnRequest({ slots: [slot('datos', 'json'), slot('n', 'number'), slot('ok', 'boolean')] });
    const result = (await convert(okMessage({ text: 'Hecho', done: true, slots: { s0: 'null', s1: 3.5, s2: false } }), request)) as { slots: Record<string, unknown> };
    expect(result.slots).toEqual({ n: 3.5, ok: false });
  });

  it('la salida debe cumplir el esquema: un slot con un tipo que no corresponde da failed con coste', async () => {
    const result = await convert(okMessage({ text: 'Hola', slots: { s0: 'no es un boolean', s1: null } }));
    expect(result).toEqual({ kind: 'failed', costUsd: expect.closeTo(COST, 12) });
  });
});

describe('Motivo de parada', () => {
  it('Rechazo del modelo', async () => {
    const result = await convert(fixture('message-refusal'));
    // 800 de entrada y 10 de salida de Opus 5.5.
    expect(result).toEqual({ kind: 'refusal', costUsd: expect.closeTo((800 * 4 + 10 * 20) / 1e6, 12) });
    expect(JSON.stringify(result)).not.toContain('MARCA-CATEGORIA');
  });

  it('Respuesta cortada o sin salida estructurada', async () => {
    const usage = fixture('message-end-turn').usage;
    const cost = expect.closeTo(COST, 12);
    const variants: [string, Record<string, unknown>][] = [
      ['max_tokens', { ...fixture('message-max-tokens') }],
      ['pause_turn', withContent([textBlock(okMessage().content)], { stop_reason: 'pause_turn' })],
      ['end_turn sin bloques text', withContent([{ type: 'thinking', thinking: 'x', signature: 'y' }])],
      ['end_turn con texto que no es JSON', withContent([textBlock('Hola, ¿en qué puedo ayudarte?')])],
      ['end_turn sin done', withContent([textBlock({ text: 'Hola', slots: { s0: null, s1: null } })])],
    ];
    for (const [name, body] of variants) {
      const result = await convert(name === 'max_tokens' ? body : { ...body, usage });
      expect(result, name).toEqual({ kind: 'failed', costUsd: name === 'max_tokens' ? expect.closeTo((900 * 4 + 8192 * 20) / 1e6, 12) : cost });
    }
  });

  it('Pensamiento fuera del resultado', async () => {
    const result = await convert(fixture('message-thinking'));
    expect(result).toMatchObject({ kind: 'turn', text: 'Hola' });
    expect(JSON.stringify(result)).not.toContain('MARCA-PENSAMIENTO');
  });

  it('stop_reason se comprueba antes de leer el contenido: un end_turn válido con otro motivo no es un turno', async () => {
    const body = okMessage({ text: 'Hola' }, { stop_reason: 'tool_use' });
    expect(await convert(body)).toMatchObject({ kind: 'failed' });
    expect(await convert(okMessage({ text: 'Hola' }, { stop_reason: 'model_context_window_exceeded' }))).toMatchObject({ kind: 'failed' });
    expect(await convert(okMessage({ text: 'Hola' }, { stop_reason: undefined }))).toMatchObject({ kind: 'failed' });
  });

  it('una respuesta que no es un mensaje da failed sin coste', async () => {
    expect(await convert({ nada: true })).toEqual({ kind: 'failed', costUsd: 0 });
  });
});
