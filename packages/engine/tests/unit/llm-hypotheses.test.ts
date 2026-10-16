import type { LlmNode } from '@franca/spec';
import { describe, expect, it, vi } from 'vitest';
import { checkTextAnswer } from '../../src/input/answer.js';
import { copyJsonValue } from '../../src/llm/json-copy.js';
import { readTurnResult } from '../../src/llm/result.js';
import { collectSlots, convertSlotValue, slotSpecs, type SlotSpec } from '../../src/llm/slots.js';
import { readAssistantText } from '../../src/llm/text.js';
import type { VariableType, VariableValue } from '../../src/types.js';

// Cuenta las llamadas a `hasUnstorable` con el texto que reciben (la implementación real sigue ejecutándose).
const unstorableCalls = vi.hoisted(() => ({ lengths: [] as number[] }));
vi.mock('../../src/input/parsers/chars.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/input/parsers/chars.js')>();
  return {
    ...actual,
    hasUnstorable: (text: string) => {
      unstorableCalls.lengths.push(text.length);
      return actual.hasUnstorable(text);
    },
  };
});

const datosSpec: SlotSpec[] = [{ name: 'datos', type: 'json', description: '', required: true }];
const TURN = { kind: 'turn', text: 'x', done: false, costUsd: 0 };

/** Un array anidado `levels` veces, construido sin recursión. */
function nest(levels: number): unknown {
  let value: unknown = [];
  for (let i = 1; i < levels; i++) value = [value];
  return value;
}

describe('Hipótesis: un slot json del host se lee una vez y con trabajo acotado', () => {
  it('un json de 100 000 niveles no se recoge, no revienta la pila y la lectura termina', () => {
    const result = readTurnResult({ ...TURN, slots: { datos: nest(100_000) } }, datosSpec) as { values: Map<string, unknown> };
    expect(result.values.has('datos')).toBe(false);
  });

  it('un getter que cambia entre lecturas se lee una vez y se guarda lo leído', () => {
    let reads = 0;
    const datos = {
      get a() {
        reads++;
        return reads === 1 ? 1 : [[[]]];
      },
    };
    const result = readTurnResult({ ...TURN, slots: { datos } }, datosSpec) as { values: Map<string, unknown> };
    expect(reads).toBe(1);
    expect(result.values.get('datos')).toEqual({ a: 1 });
  });

  it('un Proxy cuya trampa get lanza en el tercer nivel → null de readTurnResult', () => {
    const third = new Proxy({ x: 1 }, { get() { throw new Error('tercer nivel'); } });
    const datos = [[third]];
    expect(readTurnResult({ ...TURN, slots: { datos } }, datosSpec)).toBeNull();
  });

  it('un grafo de 60 niveles con referencias compartidas se corta con ≤ 4097 lecturas', () => {
    let reads = 0;
    const counting: ProxyHandler<object> = {
      get(target, key, receiver) {
        reads++;
        return Reflect.get(target, key, receiver);
      },
    };
    let level: object = {};
    for (let i = 0; i < 60; i++) {
      const child = level;
      level = new Proxy({ a: child, b: child }, counting);
    }
    // Un tope por si la cota falla: lanzar corta la ejecución en vez de colgarla (2^60 ramas).
    const guarded = new Proxy(level, {
      get(target, key, receiver) {
        if (reads > 100_000) throw new Error('sin cota: demasiadas lecturas');
        return counting.get!(target, key, receiver);
      },
    });
    const result = readTurnResult({ ...TURN, slots: { datos: guarded } }, datosSpec) as { values: Map<string, unknown> };
    expect(result.values.has('datos')).toBe(false);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(4097);
  });

  it('un array con length 2³²−1 se rechaza tras leer solo length (sin tocar ningún índice)', () => {
    const traps: string[] = [];
    const target: unknown[] = [];
    target.length = 2 ** 32 - 1;
    const proxy = new Proxy(target, {
      get(t, key, r) {
        traps.push(`get:${String(key)}`);
        return Reflect.get(t, key, r);
      },
      has(t, key) {
        traps.push(`has:${String(key)}`);
        return Reflect.has(t, key);
      },
      getOwnPropertyDescriptor(t, key) {
        traps.push(`descriptor:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
      ownKeys(t) {
        traps.push('ownKeys');
        return Reflect.ownKeys(t);
      },
    });
    expect(copyJsonValue(proxy)).toEqual({ ok: false });
    expect(traps).toEqual(['get:length']);
  });

  it('un string de 10⁷ con U+0000 al final se rechaza sin recorrerlo (hasUnstorable no ve ese texto)', () => {
    unstorableCalls.lengths.length = 0;
    expect(copyJsonValue(`${'a'.repeat(10_000_000)}\u0000`)).toEqual({ ok: false });
    expect(copyJsonValue({ [`${'k'.repeat(5_000_000)}\u0000`]: 1 })).toEqual({ ok: false });
    expect(copyJsonValue([`${'a'.repeat(10_000_000)}\u0000`])).toEqual({ ok: false });
    expect(Math.max(0, ...unstorableCalls.lengths)).toBeLessThanOrEqual(4096);
  });

  it('el mismo texto, si cabe, sí se examina (el contador funciona)', () => {
    unstorableCalls.lengths.length = 0;
    expect(copyJsonValue('a\u0000b')).toEqual({ ok: false });
    expect(unstorableCalls.lengths).toContain(3);
  });
});

describe('Hipótesis: construir la petición es lineal en el flujo', () => {
  /** Un Map que cuenta sus consultas. */
  class CountingMap<K, V> extends Map<K, V> {
    gets = 0;
    override get(key: K): V | undefined {
      this.gets++;
      return super.get(key);
    }
  }

  it('con 50 000 slots distintos hay 50 000 consultas de tipo, una por slot', () => {
    const n = 50_000;
    const types = new CountingMap<string, VariableType>();
    const slots = [];
    for (let i = 0; i < n; i++) {
      types.set(`v${i}`, 'string');
      slots.push({ variable: `v${i}`, description: 'd' });
    }
    const specs = slotSpecs({ slots } as Pick<LlmNode, 'slots'>, types);
    expect(specs).toHaveLength(n);
    expect(types.gets).toBe(n);
  });

  it('un slot repetido no se consulta dos veces', () => {
    const types = new CountingMap<string, VariableType>([['a', 'string']]);
    slotSpecs({ slots: [{ variable: 'a', description: '' }, { variable: 'a', description: '' }, { variable: 'a', description: '' }] }, types);
    expect(types.gets).toBe(1);
  });
});

describe('Hipótesis: revalidar al reanudar no pierde valores (convertir es idempotente)', () => {
  const VALID: Record<VariableType, unknown[]> = {
    string: ['  precio del envío ', 'a', 'ñandú', 'a'.repeat(4096), '1.500', 'sí'],
    email: [' Ana@Example.COM ', 'a@b.co', "o'brien+tag@sub.example.org", 'X@EXAMPLE.COM'],
    phone: ['+34 600 12 34 56', '(91) 123-45.67', '600123456', '+1 202 555 0100'],
    number: ['3,5', '3.5', '-12', '+7', '0', '-0', '0,5', '1234567', '12.34', 1500, 0.1, -2.5, -0],
    url: ['example.com', 'http://Example.com/a?b=c', 'https://example.com', 'example.com/a b', 'https://xn--bcher-kva.example/'],
    date: ['2026-10-16', '2024-02-29', '0001-01-01', '9999-12-31'],
    boolean: ['sí', 'No', 'true', 'FALSE', true, false],
    json: [{ a: [1, 'x'] }, 'texto', [1, [2, [3]]], 5, true, { '': null }],
  };

  for (const type of Object.keys(VALID) as VariableType[]) {
    it(`${type}: convert(convert(v)) es convert(v) para cada valor aceptado`, () => {
      const results = VALID[type].map((value) => ({ value, once: convertSlotValue(type, value, 'es') })).filter(({ once }) => once !== undefined);
      expect(results.length).toBeGreaterThan(0);
      for (const { value, once } of results) {
        const twice = convertSlotValue(type, once, 'es');
        expect(twice, `${type}: ${JSON.stringify(value)}`).toEqual(once);
      }
      // Los numbers se comparan además con Object.is (que distingue -0 de 0).
      for (const { once } of results.filter(({ once }) => typeof once === 'number')) expect(Object.is(convertSlotValue(type, once, 'es'), once)).toBe(true);
    });
  }

  it('también a través de collectSlots', () => {
    const specs: SlotSpec[] = (Object.keys(VALID) as VariableType[]).map((type) => ({ name: type, type, description: '', required: false }));
    const values = new Map<string, unknown>(specs.map((s) => [s.name, VALID[s.type]![0]]));
    const once = collectSlots(values, specs, 'es');
    const twice = collectSlots(once as ReadonlyMap<string, VariableValue>, specs, 'es');
    expect(twice).toEqual(once);
  });
});

describe('Hipótesis: 4097 espacios', () => {
  it('el mensaje del usuario mide el texto sin recortar (too_long) y el del asistente el recortado (vacío)', () => {
    expect(checkTextAnswer(' '.repeat(4097), 'text', 'es', { program: null })).toEqual({ ok: false, reason: 'too_long' });
    expect(readAssistantText(' '.repeat(4097))).toBeNull();
    expect(readAssistantText(`${' '.repeat(2000)}a${' '.repeat(2000)}`)).toBe('a');
  });
});
