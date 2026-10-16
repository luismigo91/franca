import { describe, expect, it } from 'vitest';
import { llmFlow, variable } from '../helpers/flows.js';
import { alwaysLlm, scriptedLlm, turn } from '../helpers/llm-host.js';
import { begin, chat, expectEnded, expectFailed, proceed } from '../helpers/llm-run.js';

/** Un array anidado `levels` veces, construido sin recursión. */
function nest(levels: number): unknown {
  let value: unknown = [];
  for (let i = 1; i < levels; i++) value = [value];
  return value;
}

/** Un `llm` con un slot por cada variable (de sesión, no de contacto), obligatorios salvo los de `optional`. */
function typedFlow(types: Record<string, string>, optional: string[] = []) {
  return llmFlow(
    { slots: Object.keys(types).map((name) => ({ variable: name, description: `Valor de ${name}`, ...(optional.includes(name) ? { required: false } : {}) })) },
    { variables: Object.entries(types).map(([name, type]) => variable(name, { type })), extra: { locale: 'es' } },
  );
}

describe('Slots que el nodo no declara', () => {
  it('Slots inventados por el modelo', async () => {
    const llm = alwaysLlm(turn('Gracias', { email: 'ana@example.com', nombre: 'SLOT-AJENO', admin: true }, true));
    const result = await begin(llmFlow(), llm.host);
    expectEnded(result, 'ok');
    expect(result.state.contact.email).toBe('ana@example.com');
    expect(result.state.variables).toEqual({});
    const serialized = JSON.stringify([result.events, result.state]);
    expect(serialized).not.toContain('SLOT-AJENO');
    expect(serialized).not.toContain('admin');
  });

  it('Propiedad heredada', async () => {
    const inherited = Object.create({ email: 'ana@example.com' }) as Record<string, unknown>;
    const llm = alwaysLlm(turn('Gracias', inherited, true));
    const [first] = await chat(llmFlow(), llm.host, ['Hola']);
    expect(first!.status).toBe('waiting');
    expect(first!.state.contact.email).toBeNull();
    expect(llm.requests[1]!.slots[0]!.collected).toBe(false);
  });

  it('Slots con nombre de Object', async () => {
    const flow = llmFlow(
      { slots: [{ variable: 'constructor', description: 'c' }, { variable: '__proto__', description: 'p' }] },
      { variables: [variable('constructor'), variable('__proto__')] },
    );
    const slots = JSON.parse('{"constructor": "c", "__proto__": "p"}') as Record<string, unknown>;
    const result = await begin(flow, alwaysLlm(turn('Hecho', slots, true)).host);
    expectEnded(result, 'ok');
    expect(Object.hasOwn(result.state.variables, 'constructor')).toBe(true);
    expect(Object.hasOwn(result.state.variables, '__proto__')).toBe(true);
    expect(result.state.variables.constructor).toBe('c');
    expect(Object.getOwnPropertyDescriptor(result.state.variables, '__proto__')?.value).toBe('p');
  });
});

describe('Conversión de los slots', () => {
  const TYPES = { email: 'email', tel: 'phone', n: 'number', m: 'number', ok: 'boolean', si: 'boolean', web: 'url', fecha: 'date', nota: 'string' };

  it('Conversiones válidas', async () => {
    const slots = { email: ' Ana@Example.COM ', tel: '+34 600 12 34 56', n: '3,5', m: 1500, ok: true, si: 'sí', web: 'example.com', fecha: '2026-10-16', nota: '  precio del envío ' };
    const result = await begin(typedFlow(TYPES), alwaysLlm(turn('Listo', slots, true)).host);
    expectEnded(result, 'ok');
    expect(result.state.variables).toEqual({
      email: 'Ana@example.com',
      tel: '+34600123456',
      n: 3.5,
      m: 1500,
      ok: true,
      si: true,
      web: 'https://example.com/',
      fecha: '2026-10-16',
      nota: 'precio del envío',
    });
  });

  it('Valores que no se pueden convertir', async () => {
    const flow = typedFlow({ email: 'email', n: 'number', ok: 'boolean', fecha: 'date', nota: 'string', web: 'url' }, ['email', 'n', 'ok', 'fecha', 'nota']);
    const slots = { email: 'ana@', n: '1.500', ok: 'quizá', fecha: '16/10/2026', nota: 42, web: 'https://localhost' };
    const result = await begin(flow, alwaysLlm(turn('Listo', slots, true)).host);
    expect(result.status).toBe('waiting');
    expect(result.state.conversation?.collected).toEqual({});
    expect(result.state.variables).toEqual({});
    const serialized = JSON.stringify([result.events, result.state]);
    for (const rejected of ['ana@', '1.500', 'quizá', '16/10/2026', 'localhost']) expect(serialized).not.toContain(rejected);
  });

  it('Tipos JSON que no corresponden', async () => {
    const flow = typedFlow({ n: 'number', ok: 'boolean', nota: 'string' });
    for (const slots of [{ n: true, ok: 1, nota: ['a'] }, { n: null, ok: null, nota: null }]) {
      const result = await begin(flow, alwaysLlm(turn('Listo', slots, true)).host);
      expect(result.status).toBe('waiting');
      expect(result.state.conversation?.collected).toEqual({});
    }
  });

  it('Strings demasiado largos en un slot', async () => {
    const flow = typedFlow({ nota: 'string' });
    const exact = await begin(flow, alwaysLlm(turn('Listo', { nota: 'a'.repeat(4096) }, true)).host);
    expectEnded(exact, 'ok');
    expect(exact.state.variables.nota).toBe('a'.repeat(4096));
    const over = await begin(flow, alwaysLlm(turn('Listo', { nota: 'a'.repeat(4097) }, true)).host);
    expect(over.status).toBe('waiting');
    expect(over.state.conversation?.collected).toEqual({});
  });
});

describe('Slots de tipo json', () => {
  const jsonFlow = () => typedFlow({ datos: 'json' });

  it('Valores json', async () => {
    const accepted = [{ a: [1, 'x'] }, 'texto', nest(100), 'a'.repeat(4096)];
    for (const datos of accepted) {
      const result = await begin(jsonFlow(), alwaysLlm(turn('Listo', { datos }, true)).host);
      expectEnded(result, 'ok');
      expect(result.state.variables.datos).toEqual(datos);
    }
    for (const datos of [nest(101), { 'k\u0000': 1 }, 'a'.repeat(4097)]) {
      const result = await begin(jsonFlow(), alwaysLlm(turn('Listo', { datos }, true)).host);
      expect(result.status).toBe('waiting');
      expect(result.state.variables).toEqual({});
    }
  });

  it('Valor json que cambia entre lecturas', async () => {
    let reads = 0;
    const datos = {
      get a() {
        reads++;
        return reads === 1 ? 1 : [[[]]];
      },
    };
    const result = await begin(jsonFlow(), alwaysLlm(turn('Listo', { datos }, true)).host);
    expect(reads).toBe(1);
    expectEnded(result, 'ok');
    expect(result.state.variables.datos).toEqual({ a: 1 });
  });

  it('Lectura que lanza dentro de un valor json', async () => {
    const datos = [[new Proxy({ x: 1 }, { get() { throw new Error('MARCA-PROXY'); } })]];
    const result = await begin(jsonFlow(), alwaysLlm(turn('Listo', { datos }, true)).host);
    expectFailed(result, 'llm_host_error', 'a');
    expect(JSON.stringify(result.events)).not.toContain('MARCA-PROXY');
  });

  it('Valor json con referencias compartidas', async () => {
    let level: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) level = { a: level, b: level };
    const result = await begin(jsonFlow(), alwaysLlm(turn('Listo', { datos: level }, true)).host);
    expect(result.status).toBe('waiting');
    expect(result.state.conversation?.collected).toEqual({});
  });
});

describe('Slots recogidos', () => {
  const two = () =>
    llmFlow(
      { slots: [{ variable: 'nombre', description: 'n' }, { variable: 'email', description: 'e' }] },
      { variables: [variable('nombre'), variable('email', { type: 'email', scope: 'contact', pii: true })] },
    );

  it('Valores de varios turnos', async () => {
    const llm = scriptedLlm([
      turn('uno', { nombre: 'Ana' }),
      turn('dos', { email: 'ana@' }),
      turn('tres', { email: 'ana@example.com', nombre: null }, true),
    ]);
    const results = await chat(two(), llm.host, ['x', 'y']);
    expect(results[1]!.status).toBe('waiting');
    expect(results[1]!.state.conversation?.collected).toEqual({ nombre: 'Ana' });
    expectEnded(results[2]!, 'ok');
    expect(results[2]!.state.variables).toEqual({ nombre: 'Ana' });
    expect(results[2]!.state.contact.email).toBe('ana@example.com');
  });

  it('Corrección de un slot', async () => {
    const llm = scriptedLlm([turn('uno', { email: 'ana@example.com' }), turn('dos', { email: 'ana.perez@example.com' }, true)]);
    const results = await chat(llmFlow(), llm.host, ['corrijo']);
    expectEnded(results[1]!, 'ok');
    expect(results[1]!.state.contact.email).toBe('ana.perez@example.com');
  });

  it('Las variables no cambian mientras se conversa', async () => {
    const result = await begin(llmFlow(), alwaysLlm(turn('uno', { email: 'nuevo@example.com' })).host, { email: 'previo@example.com' });
    expect(result.status).toBe('waiting');
    expect(result.state.contact).toEqual({ email: 'previo@example.com' });
    expect(result.state.conversation?.collected).toEqual({ email: 'nuevo@example.com' });
  });

  it('Flujo cambiado mientras se conversa', async () => {
    const first = await begin(llmFlow(), alwaysLlm(turn('uno', { email: 'ana@example.com' })).host);
    expect(first.state.conversation?.collected).toEqual({ email: 'ana@example.com' });
    const changed = llmFlow({ slots: undefined });
    const result = await proceed(changed, first.state, 'Hola', alwaysLlm(turn('dos', {}, true)).host);
    expectEnded(result, 'ok');
    expect(result.state.contact.email).toBeNull();
  });
});
