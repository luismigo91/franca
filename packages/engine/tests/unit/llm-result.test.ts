import { describe, expect, it } from 'vitest';
import { invokeLlm, readLlmCapability } from '../../src/llm/capability.js';
import { LLM_RESULT_KINDS, readTurnResult } from '../../src/llm/result.js';
import type { SlotSpec } from '../../src/llm/slots.js';
import type { EngineHost, LlmTurnRequest } from '../../src/index.js';

const SPECS: SlotSpec[] = [
  { name: 'email', type: 'email', description: 'e', required: true },
  { name: 'nota', type: 'string', description: 'n', required: false },
  { name: 'datos', type: 'json', description: 'd', required: false },
];

const TURN = { kind: 'turn', text: 'Hola', slots: {}, done: false, costUsd: 0.01 };
const REQUEST = { nodeId: 'a' } as LlmTurnRequest;

/** Un objeto cuyas propiedades son getters que cuentan cuántas veces se leyeron. */
function counted(values: Record<string, unknown>): { object: Record<string, unknown>; reads: Record<string, number> } {
  const reads: Record<string, number> = {};
  const object: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    reads[name] = 0;
    Object.defineProperty(object, name, {
      enumerable: true,
      get() {
        reads[name]!++;
        return value;
      },
    });
  }
  return { object, reads };
}

describe('readLlmCapability', () => {
  it('una función es la capacidad', () => {
    const call = () => Promise.resolve(TURN);
    expect(readLlmCapability({ llm: call as unknown as EngineHost['llm'] })).toEqual({ kind: 'present', call });
  });

  it.each([undefined, null, 'no', 3, {}, []])('%j no es una capacidad (absent)', (llm) => {
    expect(readLlmCapability({ llm } as unknown as EngineHost)).toEqual({ kind: 'absent' });
  });

  it('un host sin la propiedad es absent', () => {
    expect(readLlmCapability({})).toEqual({ kind: 'absent' });
  });

  it('un getter que lanza es error, no una excepción', () => {
    const host = {
      get llm(): never {
        throw new Error('MARCA-GETTER');
      },
    } as EngineHost;
    expect(readLlmCapability(host)).toEqual({ kind: 'error' });
  });

  it('lee la propiedad una sola vez', () => {
    let reads = 0;
    const host = {
      get llm() {
        reads++;
        return () => Promise.resolve(TURN);
      },
    } as unknown as EngineHost;
    readLlmCapability(host);
    expect(reads).toBe(1);
  });
});

describe('invokeLlm', () => {
  it('devuelve lo que resuelve el host, sin leerlo', async () => {
    const value = counted({ kind: 'turn' });
    const called = await invokeLlm(() => Promise.resolve(value.object), {}, REQUEST);
    expect(called).toEqual({ ok: true, value: value.object });
    expect(value.reads.kind).toBe(0);
  });

  it('llama con el host como this y con la petición', async () => {
    const seen: { receiver: unknown; args: unknown[] }[] = [];
    const host: EngineHost = {};
    await invokeLlm(
      function (this: unknown, ...args: unknown[]) {
        seen.push({ receiver: this, args });
        return Promise.resolve(TURN);
      },
      host,
      REQUEST,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.receiver).toBe(host);
    expect(seen[0]!.args).toEqual([REQUEST]);
    expect(seen[0]!.args[0]).toBe(REQUEST);
  });

  it.each([
    ['lanza de forma síncrona', () => { throw new Error('MARCA-CONVERSACION'); }],
    ['rechaza', () => Promise.reject(new Error('MARCA-CONVERSACION'))],
    ['rechaza con un valor que no es un error', () => Promise.reject('MARCA-CONVERSACION')],
  ])('si el host %s → { ok: false } sin nada del error', async (_name, call) => {
    const called = await invokeLlm(call, {}, REQUEST);
    expect(called).toEqual({ ok: false });
    expect(JSON.stringify(called)).not.toContain('MARCA-CONVERSACION');
  });
});

describe('readTurnResult: formas válidas', () => {
  it('un turn', () => {
    expect(readTurnResult({ kind: 'turn', text: 'Hola', slots: { email: 'a@b.co' }, done: true, costUsd: 0.5 }, SPECS)).toEqual({
      kind: 'turn',
      text: 'Hola',
      values: new Map([['email', 'a@b.co']]),
      done: true,
      costUsd: 0.5,
    });
  });

  it('un rechazo y un fallo solo llevan el coste', () => {
    expect(readTurnResult({ kind: 'refusal', costUsd: 0.004 }, SPECS)).toEqual({ kind: 'refusal', costUsd: 0.004 });
    expect(readTurnResult({ kind: 'failed', costUsd: 0 }, SPECS)).toEqual({ kind: 'failed', costUsd: 0 });
  });

  it('not_configured no necesita nada más', () => {
    expect(readTurnResult({ kind: 'not_configured' }, SPECS)).toEqual({ kind: 'not_configured' });
  });

  it('las propiedades adicionales se ignoran y no se leen', () => {
    const { object, reads } = counted({ ...TURN, usage: { inputTokens: 10 }, model: 'x' });
    const result = readTurnResult(object, SPECS);
    expect(result).toEqual({ kind: 'turn', text: 'Hola', values: new Map(), done: false, costUsd: 0.01 });
    expect(result).not.toHaveProperty('usage');
    expect(reads.usage).toBe(0);
    expect(reads.model).toBe(0);
  });

  it('en un failed solo se lee kind y costUsd', () => {
    const { object, reads } = counted({ kind: 'failed', costUsd: 1, text: 'x', slots: {}, done: true });
    readTurnResult(object, SPECS);
    expect(reads).toEqual({ kind: 1, costUsd: 1, text: 0, slots: 0, done: 0 });
  });

  it('cada propiedad del turn se lee exactamente una vez', () => {
    const { object, reads } = counted(TURN);
    expect(readTurnResult(object, SPECS)).not.toBeNull();
    expect(reads).toEqual({ kind: 1, text: 1, slots: 1, done: 1, costUsd: 1 });
  });

  it('acepta cualquier prototipo: null o una clase', () => {
    expect(readTurnResult(Object.assign(Object.create(null), TURN), SPECS)).not.toBeNull();
    class Result {
      kind = 'turn';
      text = 'Hola';
      slots = {};
      done = false;
      costUsd = 0;
    }
    expect(readTurnResult(new Result(), SPECS)).not.toBeNull();
  });

  it('-0 en costUsd es 0', () => {
    for (const kind of ['refusal', 'failed']) expect(Object.is((readTurnResult({ kind, costUsd: -0 }, SPECS) as { costUsd: number }).costUsd, 0)).toBe(true);
    expect(Object.is((readTurnResult({ ...TURN, costUsd: -0 }, SPECS) as { costUsd: number }).costUsd, 0)).toBe(true);
  });

  it('LLM_RESULT_KINDS son los cuatro kind de LlmTurnResult', () => {
    expect([...LLM_RESULT_KINDS]).toEqual(['turn', 'refusal', 'failed', 'not_configured']);
  });
});

describe('readTurnResult: resultados mal formados → null', () => {
  const bad: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['un número', 5],
    ['un string', 'turn'],
    ['un array', []],
    ['una función', () => TURN],
    ['sin kind', {}],
    ['kind desconocido', { kind: 'otro' }],
    ['kind con otra capitalización', { kind: 'Turn', text: 'x', slots: {}, done: false, costUsd: 0 }],
    ['turn con costUsd negativo', { ...TURN, costUsd: -0.01 }],
    ['turn con costUsd NaN', { ...TURN, costUsd: Number.NaN }],
    ['turn con costUsd Infinity', { ...TURN, costUsd: Infinity }],
    ['turn con costUsd string', { ...TURN, costUsd: '0.01' }],
    ['turn sin costUsd', { kind: 'turn', text: 'x', slots: {}, done: false }],
    ['turn con text 5', { ...TURN, text: 5 }],
    ['turn sin text', { kind: 'turn', slots: {}, done: false, costUsd: 0 }],
    ['turn con slots array', { ...TURN, slots: [] }],
    ['turn con slots null', { ...TURN, slots: null }],
    ['turn con slots string', { ...TURN, slots: 'email' }],
    ['turn sin slots', { kind: 'turn', text: 'x', done: false, costUsd: 0 }],
    ['turn con done string', { ...TURN, done: 'true' }],
    ['turn sin done', { kind: 'turn', text: 'x', slots: {}, costUsd: 0 }],
    ['failed sin costUsd', { kind: 'failed' }],
    ['refusal sin costUsd', { kind: 'refusal' }],
    ['refusal con costUsd -1', { kind: 'refusal', costUsd: -1 }],
    ['failed con costUsd Infinity', { kind: 'failed', costUsd: Infinity }],
  ];
  it.each(bad)('%s', (_name, raw) => {
    expect(readTurnResult(raw, SPECS)).toBeNull();
  });

  it.each(['kind', 'text', 'slots', 'done', 'costUsd'])('un getter %s que lanza → null, sin propagar', (property) => {
    const raw = { ...TURN };
    Object.defineProperty(raw, property, {
      enumerable: true,
      get(): never {
        throw new Error('MARCA-GETTER');
      },
    });
    expect(readTurnResult(raw, SPECS)).toBeNull();
  });

  it('un getter costUsd que lanza en un failed → null', () => {
    const raw = { kind: 'failed' };
    Object.defineProperty(raw, 'costUsd', {
      get(): never {
        throw new Error('x');
      },
    });
    expect(readTurnResult(raw, SPECS)).toBeNull();
  });
});

describe('readTurnResult: slots', () => {
  it('solo recoge los nombres declarados, aunque haya otros', () => {
    const result = readTurnResult({ ...TURN, slots: { email: 'a@b.co', nombre: 'SLOT-AJENO', admin: true } }, SPECS);
    expect(result).toMatchObject({ values: new Map([['email', 'a@b.co']]) });
    expect(JSON.stringify([...(result as { values: Map<string, unknown> }).values])).not.toContain('SLOT-AJENO');
  });

  it('una propiedad heredada no cuenta', () => {
    const slots = Object.create({ email: 'ana@example.com' }) as Record<string, unknown>;
    const result = readTurnResult({ ...TURN, slots }, SPECS) as { values: Map<string, unknown> };
    expect(result.values.size).toBe(0);
  });

  it('un valor null de un slot se conserva como null (la conversión lo ignora)', () => {
    const result = readTurnResult({ ...TURN, slots: { email: null } }, SPECS) as { values: Map<string, unknown> };
    expect(result.values.has('email')).toBe(true);
    expect(result.values.get('email')).toBeNull();
  });

  it('un valor de un slot que no es json se pasa sin mirarlo por dentro', () => {
    const { object: value, reads } = counted({ x: 1 });
    const result = readTurnResult({ ...TURN, slots: { nota: value } }, SPECS) as { values: Map<string, unknown> };
    expect(result.values.get('nota')).toBe(value);
    expect(reads.x).toBe(0);
  });

  it('lee cada slot declarado una vez', () => {
    const { object, reads } = counted({ email: 'a@b.co', nota: 'n', datos: { a: 1 }, ajeno: 1 });
    readTurnResult({ ...TURN, slots: object }, SPECS);
    expect(reads).toEqual({ email: 1, nota: 1, datos: 1, ajeno: 0 });
  });

  it('un slot json se devuelve ya copiado, no el objeto del host', () => {
    const datos = { a: [1, 'x'] };
    const result = readTurnResult({ ...TURN, slots: { datos } }, SPECS) as { values: Map<string, unknown> };
    expect(result.values.get('datos')).toEqual(datos);
    expect(result.values.get('datos')).not.toBe(datos);
  });

  it.each([
    ['con NaN', { a: Number.NaN }],
    ['con undefined', { a: undefined }],
    ['con una función', { a: () => 1 }],
    ['con una clase', new (class Foo {})()],
    ['con U+0000', { 'k\u0000': 1 }],
    ['de 4097 caracteres', 'a'.repeat(4097)],
  ])('un slot json %s no se recoge (ausente en values)', (_name, datos) => {
    const result = readTurnResult({ ...TURN, slots: { datos, email: 'a@b.co' } }, SPECS) as { values: Map<string, unknown> };
    expect(result.values.has('datos')).toBe(false);
    expect(result.values.get('email')).toBe('a@b.co');
  });

  it('una lectura que lanza dentro de un slot json → null (llm_host_error)', () => {
    const datos = [[new Proxy([], { get() { throw new Error('MARCA-PROXY'); } })]];
    expect(readTurnResult({ ...TURN, slots: { datos } }, SPECS)).toBeNull();
  });

  it('un getter de un slot declarado que lanza → null', () => {
    const slots = {};
    Object.defineProperty(slots, 'email', { enumerable: true, get(): never { throw new Error('x'); } });
    expect(readTurnResult({ ...TURN, slots }, SPECS)).toBeNull();
  });

  it('no enumera ni consulta con in: con 10⁵ claves ajenas solo se tocan los nombres declarados, una vez cada uno', () => {
    const target: Record<string, unknown> = { email: 'a@b.co', nota: 'n' };
    for (let i = 0; i < 100_000; i++) target[`ajena${i}`] = i;
    const traps: Record<string, string[]> = { get: [], has: [], ownKeys: [], getOwnPropertyDescriptor: [] };
    const slots = new Proxy(target, {
      get(t, key, r) {
        traps.get!.push(String(key));
        return Reflect.get(t, key, r);
      },
      has(t, key) {
        traps.has!.push(String(key));
        return Reflect.has(t, key);
      },
      ownKeys(t) {
        traps.ownKeys!.push('*');
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, key) {
        traps.getOwnPropertyDescriptor!.push(String(key));
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
    });
    const result = readTurnResult({ ...TURN, slots }, SPECS) as { values: Map<string, unknown> };
    expect(result.values.get('email')).toBe('a@b.co');
    expect(traps.ownKeys).toEqual([]);
    expect(traps.has).toEqual([]);
    expect([...traps.get!].sort()).toEqual(['email', 'nota']);
    // Los nombres declarados que no existen en el objeto solo se preguntan con hasOwn.
    expect(new Set(traps.getOwnPropertyDescriptor)).toEqual(new Set(['email', 'nota', 'datos']));
  });
});
