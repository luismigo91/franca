import { describe, expect, it } from 'vitest';
import { llmFlow, variable } from '../helpers/flows.js';
import { alwaysLlm, expectLlmScript, scriptedLlm, turn } from '../helpers/llm-host.js';
import { begin, chat, expectFailed, llmEvents, proceed } from '../helpers/llm-run.js';

/**
 * QA independiente de la feature 4: un proveedor hostil devuelve slots, `done` y textos en los
 * límites de cada conversor. Los escapes `\uXXXX` evitan caracteres invisibles en el fichero.
 */

const TYPED = { s: 'string', e: 'email', p: 'phone', n: 'number', u: 'url', d: 'date', b: 'boolean', j: 'json' } as const;
type Name = keyof typeof TYPED;

/** Un `llm` con un slot opcional por tipo, 50 turnos y sin `done` posible por obligatorios. */
function typedFlow() {
  return llmFlow(
    { maxTurns: 50, slots: Object.keys(TYPED).map((name) => ({ variable: name, description: `Valor de ${name}`, required: false })) },
    { variables: Object.entries(TYPED).map(([name, type]) => variable(name, { type })), extra: { locale: 'es' } },
  );
}

const A = (n: number): string => 'a'.repeat(n);

/** Un array anidado `levels` veces, construido sin recursión. */
function nest(levels: number): unknown {
  let value: unknown = [];
  for (let i = 1; i < levels; i++) value = [value];
  return value;
}

/** `[collected]` esperado: el valor guardado, o `undefined` si no se recoge. */
type Row = [name: Name, label: string, value: unknown, collected: unknown];

const NOT: unique symbol = Symbol('no se recoge');

const ROWS: Row[] = [
  ['s', 'string de 4096', A(4096), A(4096)],
  ['s', 'string de 4097', A(4097), NOT],
  ['s', 'string de 4096 con espacios (se mide sin recortar)', ` ${A(4094)} `, A(4094)],
  ['s', 'string de 4097 con espacios', ` ${A(4095)} `, NOT],
  ['s', 'U+0000', 'a\u0000b', NOT],
  ['s', 'sustituto alto suelto', 'a\ud800', NOT],
  ['s', 'sustituto bajo suelto', '\udc00a', NOT],
  ['s', 'sustituto alto al final', 'a\ud83d', NOT],
  ['s', 'par de sustitutos válido', 'ok 😀', 'ok 😀'],
  ['s', 'solo espacios', ' \n\t ', NOT],
  ['s', 'number en un string', 42, NOT],
  ['s', 'boolean en un string', true, NOT],
  ['s', 'array en un string', ['x'], NOT],
  ['s', 'objeto en un string', { a: 1 }, NOT],
  ['s', 'objeto String', Object('x'), NOT],
  ['s', 'plantilla literal', '{{s}} {{e}}', '{{s}} {{e}}'],
  ['e', 'email con U+0000', 'ana@example.com\u0000', NOT],
  ['e', 'email en mayúsculas', ' ANA@EXAMPLE.COM ', 'ANA@example.com'],
  ['e', 'sin punto en el dominio', 'a@b', NOT],
  ['e', 'dominio IP', 'a@[127.0.0.1]', NOT],
  ['e', 'dominio IPv4 sin corchetes', 'a@127.0.0.1', NOT],
  ['e', 'local de 4097', `${A(4097)}@x.com`, NOT],
  ['e', 'con espacio', 'a b@c.com', NOT],
  ['p', '6 cifras', '123456', NOT],
  ['p', '7 cifras', '1234567', '1234567'],
  ['p', '15 cifras', '123456789012345', '123456789012345'],
  ['p', '16 cifras', '1234567890123456', NOT],
  ['p', 'con formato', '+34 600 123 456', '+34600123456'],
  ['p', 'number en un phone', 34600123456, NOT],
  ['p', 'cifras arábigo-índicas', '٣٤٥٦٧٨٩', NOT],
  ['n', '15 cifras', '123456789012345', 123456789012345],
  ['n', '16 cifras', '1234567890123456', NOT],
  ['n', 'separador de miles', '1.500', NOT],
  ['n', 'coma decimal', '1,5', 1.5],
  ['n', 'notación científica en texto', '1e5', NOT],
  ['n', 'hexadecimal', '0x10', NOT],
  ['n', 'number enorme finito', 1e21, 1e21],
  ['n', 'NaN', Number.NaN, NOT],
  ['n', 'Infinity', Infinity, NOT],
  ['n', '-0', -0, 0],
  ['n', 'boolean en un number', true, NOT],
  ['n', 'dígitos de ancho completo', '１２', NOT],
  ['u', 'IPv4 decimal', 'http://2130706433/', NOT],
  ['u', 'IPv4 hexadecimal', 'http://0x7f000001/', NOT],
  ['u', 'IPv4 octal', 'http://0177.0.0.1/', NOT],
  ['u', 'IPv4 corta', 'http://127.1/', NOT],
  ['u', 'IPv6 loopback', 'http://[::1]/', NOT],
  ['u', 'IPv6 mapeada', 'http://[::ffff:127.0.0.1]/', NOT],
  ['u', 'IPv4 con ancho completo', 'http://１２７.0.0.1/', NOT],
  ['u', 'IPv4 con punto ideográfico', 'http://127。0。0。1/', NOT],
  ['u', 'IPv4 con punto final', 'http://127.0.0.1./', NOT],
  ['u', 'metadatos de la nube', 'http://169.254.169.254/latest', NOT],
  ['u', 'usuario y contraseña', 'https://user:pass@example.com/', NOT],
  ['u', 'localhost', 'http://localhost/', NOT],
  ['u', 'LOCALHOST con punto final', 'http://LOCALHOST./', NOT],
  ['u', 'host con %', 'http://%31%32%37.0.0.1/', NOT],
  ['u', 'esquema javascript', 'javascript:alert(1)', NOT],
  ['u', 'esquema file', 'file:///etc/passwd', NOT],
  ['u', 'esquema data', 'data:text/plain,hola', NOT],
  ['u', 'IDN', 'http://bücher.example/', 'http://xn--bcher-kva.example/'],
  ['u', 'sin esquema', 'example.com', 'https://example.com/'],
  ['u', 'puerto fuera de rango', 'http://example.com:65536/', NOT],
  ['u', 'url que desborda al serializar', `https://example.com/${A(4096)}`, NOT],
  ['u', 'url con U+200B en el host', 'http://​example.com/', NOT],
  ['d', '30 de febrero', '2026-02-30', NOT],
  ['d', 'año 0', '0000-01-01', NOT],
  ['d', 'año 10000', '10000-01-01', NOT],
  ['d', 'último día', '9999-12-31', '9999-12-31'],
  ['d', 'con hora', '2026-10-16T00:00:00Z', NOT],
  ['d', 'number', 20261016, NOT],
  ['d', '29 de febrero de 1900', '1900-02-29', NOT],
  ['b', 'quizá', 'quizá', NOT],
  ['b', 'sí', 'Sí', true],
  ['b', 'number 1', 1, NOT],
  ['b', 'number 0', 0, NOT],
  ['b', 'texto true', 'true', true],
  ['j', '100 niveles', nest(100), nest(100)],
  ['j', '101 niveles', nest(101), NOT],
  ['j', '100 000 niveles', nest(100000), NOT],
  ['j', 'string de 4096', A(4096), A(4096)],
  ['j', 'string de 4097', A(4097), NOT],
  ['j', 'array con 4097 elementos', new Array(4097).fill(1), NOT],
  ['j', 'array disperso', [1, , 3], NOT],
  ['j', 'array con length 2^32-1', new Array(2 ** 32 - 1), NOT],
  ['j', 'objeto con clase', new (class Cosa { x = 1; })(), NOT],
  ['j', 'Date', new Date(0), NOT],
  ['j', 'Map', new Map([['a', 1]]), NOT],
  ['j', 'Uint8Array', new Uint8Array(3), NOT],
  ['j', 'array con prototipo ajeno', Object.setPrototypeOf([1], { x: 1 }), NOT],
  ['j', 'undefined anidado', { a: undefined }, NOT],
  ['j', 'función anidada', { a: () => 1 }, NOT],
  ['j', 'símbolo anidado', { a: Symbol('x') }, NOT],
  ['j', 'bigint anidado', { a: 1n }, NOT],
  ['j', 'NaN anidado', [Number.NaN], NOT],
  ['j', 'clave con U+0000', { 'a\u0000': 1 }, NOT],
  ['j', 'valor con sustituto suelto', ['\ud800'], NOT],
  ['j', 'objeto sin prototipo', Object.assign(Object.create(null) as object, { a: [1, 'x'] }), { a: [1, 'x'] }],
  ['j', '-0 anidado', [-0], [0]],
  ['j', 'objeto vacío', {}, {}],
  ['j', 'false', false, false],
  ['j', 'cero', 0, 0],
];

describe('Slots hostiles de cada tipo (el motor convierte y rechaza igual que un input)', () => {
  it.each(ROWS)('%s: %s', async (name, _label, value, collected) => {
    const llm = alwaysLlm(turn('Sigamos', { [name]: value }));
    const started = performance.now();
    const first = await begin(typedFlow(), llm.host);
    expect(performance.now() - started, 'la lectura está acotada').toBeLessThan(1500);
    expect(first.status).toBe('waiting');
    const stored = first.state.conversation!.collected;
    if (collected === NOT) expect(stored).toEqual({});
    else expect(stored).toEqual({ [name]: collected });
    // Pasa por JSON y se reanuda: lo recogido sobrevive a la revalidación y lo rechazado no reaparece.
    const wire = JSON.parse(JSON.stringify(first.state)) as typeof first.state;
    const second = await proceed(typedFlow(), wire, 'Hola', scriptedLlm([turn('Vale', {}, false, 0)]).host);
    expect(second.state.conversation!.collected).toEqual(stored);
    expect(llm.requests[0]!.slots.find((s) => s.name === name)!.collected).toBe(false);
  });
});

describe('Lecturas del proveedor que lanzan o cambian', () => {
  it('un slot json con un getter que lanza es un fallo del host, no un slot rechazado', async () => {
    const value = { get a(): never { throw new Error('MARCA-GETTER'); } };
    const result = await begin(typedFlow(), alwaysLlm(turn('Hola', { j: value })).host);
    expectFailed(result, 'llm_host_error', 'a');
    expect(JSON.stringify(result)).not.toContain('MARCA-GETTER');
  });

  it('un Proxy cuya trampa lanza dentro de un slot json es un fallo del host', async () => {
    const value = new Proxy({}, { ownKeys: () => { throw new Error('MARCA-PROXY'); } });
    const result = await begin(typedFlow(), alwaysLlm(turn('Hola', { j: value })).host);
    expectFailed(result, 'llm_host_error', 'a');
    expect(JSON.stringify(result)).not.toContain('MARCA-PROXY');
  });

  it('un grafo de referencias compartidas que se expandiría a 2^60 nodos se rechaza deprisa', async () => {
    let node: unknown = [];
    for (let i = 0; i < 60; i++) node = [node, node];
    const started = performance.now();
    const result = await begin(typedFlow(), alwaysLlm(turn('Hola', { j: node })).host);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(result.state.conversation!.collected).toEqual({});
  });

  it('un hueco de un array no lee el prototipo (aunque alguien haya contaminado Array.prototype)', async () => {
    const proto = Array.prototype as unknown as Record<number, unknown>;
    proto[1] = 'CONTAMINADO';
    try {
      const result = await begin(typedFlow(), alwaysLlm(turn('Hola', { j: [1, , 3] })).host);
      expect(result.state.conversation!.collected).toEqual({});
      expect(JSON.stringify(result)).not.toContain('CONTAMINADO');
    } finally {
      delete proto[1];
    }
  });

  it('un ciclo se rechaza sin colgarse', async () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const result = await begin(typedFlow(), alwaysLlm(turn('Hola', { j: cycle })).host);
    expect(result.status).toBe('waiting');
    expect(result.state.conversation!.collected).toEqual({});
  });

  it('un objeto con un ciclo por una propiedad se rechaza', async () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.self = cycle;
    const result = await begin(typedFlow(), alwaysLlm(turn('Hola', { j: cycle })).host);
    expect(result.state.conversation!.collected).toEqual({});
  });

  it('el valor json recogido es una copia: mutar el original después no cambia lo recogido', async () => {
    const original = { a: [1, 2] };
    const llm = alwaysLlm(turn('Hola', { j: original }));
    const first = await begin(typedFlow(), llm.host);
    original.a.push(3);
    expect(first.state.conversation!.collected).toEqual({ j: { a: [1, 2] } });
  });
});

describe('Resultados hostiles: done, slots ajenos y objetos exóticos', () => {
  const requiredFlow = () => llmFlow({ slots: [{ variable: 'email', description: 'Email' }, { variable: 'nombre', description: 'Nombre', required: false }] });

  it('done sin los obligatorios, con solo un opcional, no termina el nodo', async () => {
    const llm = alwaysLlm(turn('Listo', { nombre: 'Ana' }, true));
    const first = await begin(requiredFlow(), llm.host);
    expect(first.status).toBe('waiting');
    expect(first.state.conversation!.collected).toEqual({ nombre: 'Ana' });
    expect(llmEvents(first)).toEqual([]);
    expect(first.state.variables).toEqual({});
  });

  it('done con un obligatorio inválido tampoco termina el nodo', async () => {
    const llm = alwaysLlm(turn('Listo', { email: 'ana@', nombre: 'Ana' }, true));
    const first = await begin(requiredFlow(), llm.host);
    expect(first.status).toBe('waiting');
    expect(first.state.contact.email).toBeNull();
  });

  it('un slot ajeno con la clave __proto__ propia no contamina ni se recoge', async () => {
    const slots = JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x", "toString": "x", "email": "ana@example.com"}') as Record<string, unknown>;
    const result = await begin(requiredFlow(), alwaysLlm(turn('Gracias', slots, true)).host);
    expect(result.status).toBe('ended');
    expect(result.state.contact.email).toBe('ana@example.com');
    expect(Object.keys(result.state.variables)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('polluted');
  });

  it('slots como Proxy: solo se consultan los nombres declarados', async () => {
    const touched: string[] = [];
    const slots = new Proxy({ email: 'ana@example.com', otro: 'x' } as Record<string, unknown>, {
      get: (target, key) => {
        touched.push(String(key));
        return target[key as string];
      },
      has: () => { throw new Error('has'); },
      ownKeys: () => { throw new Error('ownKeys'); },
    });
    const result = await begin(requiredFlow(), alwaysLlm(turn('Gracias', slots, true)).host);
    expect(result.status).toBe('ended');
    // `Object.hasOwn` no pasa por `has` ni `ownKeys`; la lectura solo ocurre en los declarados que existen.
    expect(touched).toEqual(['email']);
  });

  it('slots como Proxy cuyo descriptor lanza para un nombre declarado es un fallo del host', async () => {
    const slots = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('MARCA-DESCRIPTOR'); } });
    const result = await begin(requiredFlow(), alwaysLlm(turn('Gracias', slots, true)).host);
    expectFailed(result, 'llm_host_error', 'a');
    expect(JSON.stringify(result)).not.toContain('MARCA-DESCRIPTOR');
  });

  it('un slot declarado con el nombre then se recoge como cualquier otro', async () => {
    const flow = llmFlow(
      { slots: [{ variable: 'then', description: 'Valor' }, { variable: 'catch', description: 'Otro', required: false }] },
      { variables: [variable('then'), variable('catch')] },
    );
    const slots = JSON.parse('{"then": "dentro", "catch": "fuera"}') as Record<string, unknown>;
    const result = await begin(flow, alwaysLlm(turn('Hecho', slots, true)).host);
    expect(result.status).toBe('ended');
    expect(result.state.variables).toEqual({ then: 'dentro', catch: 'fuera' });
  });

  it('un resultado con then como función se espera como una promesa y su valor se lee igual', async () => {
    const thenable = { then: (resolve: (v: unknown) => void) => resolve(turn('Desde un thenable', {}, false)) };
    const result = await begin(llmFlow(), { llm: (() => thenable) as never });
    expect(result.status).toBe('waiting');
    expect(JSON.stringify(result.events)).toContain('Desde un thenable');
  });

  it.each([
    ['slots es un array', { kind: 'turn', text: 'x', slots: [], done: false, costUsd: 0 }],
    ['slots es una función', { kind: 'turn', text: 'x', slots: () => 1, done: false, costUsd: 0 }],
    ['slots es null', { kind: 'turn', text: 'x', slots: null, done: false, costUsd: 0 }],
    ['slots es un string', { kind: 'turn', text: 'x', slots: 'email', done: false, costUsd: 0 }],
    ['done es un string', { kind: 'turn', text: 'x', slots: {}, done: 'true', costUsd: 0 }],
    ['done es 1', { kind: 'turn', text: 'x', slots: {}, done: 1, costUsd: 0 }],
    ['costUsd es un string', { kind: 'turn', text: 'x', slots: {}, done: false, costUsd: '0.01' }],
    ['costUsd negativo', { kind: 'turn', text: 'x', slots: {}, done: false, costUsd: -0.01 }],
    ['costUsd NaN', { kind: 'turn', text: 'x', slots: {}, done: false, costUsd: Number.NaN }],
    ['costUsd Infinity', { kind: 'turn', text: 'x', slots: {}, done: false, costUsd: Infinity }],
    ['costUsd ausente', { kind: 'turn', text: 'x', slots: {}, done: false }],
    ['text no es un string', { kind: 'turn', text: ['x'], slots: {}, done: false, costUsd: 0 }],
    ['kind en mayúsculas', { kind: 'TURN', text: 'x', slots: {}, done: false, costUsd: 0 }],
    ['refusal sin coste', { kind: 'refusal' }],
    ['failed con coste negativo', { kind: 'failed', costUsd: -1 }],
    ['un array', []],
    ['un string', 'turn'],
    ['undefined', undefined],
    ['null', null],
  ])('resultado fuera de contrato (%s): llm_host_error sin filtrar', async (_label, raw) => {
    const result = await begin(llmFlow(), { llm: (async () => raw) as never });
    expectFailed(result, 'llm_host_error', 'a');
    expect(result.events.filter((e) => e.type === 'llm')).toEqual([]);
  });
});

describe('Texto del asistente', () => {
  const emit = async (text: string) => begin(llmFlow(), alwaysLlm(turn(text)).host);

  it.each(['{{email}}', '{{ nombre }}', '{{{email}}}', '{{__proto__}}', '{{constructor}}', '{{', '}}{{', '{{#if x}}', '${email}', '%s'])('no renderiza %j', async (text) => {
    const flow = llmFlow();
    const llm = alwaysLlm(turn(text));
    const first = await begin(flow, llm.host, { email: 'ana@example.com' });
    const message = first.events.find((e) => e.type === 'message');
    expect(message).toMatchObject({ content: [{ kind: 'text', text }] });
    const second = await proceed(flow, first.state, 'Hola', llm.host);
    expect(llm.requests[1]!.history[0]).toEqual({ role: 'assistant', text });
    expect(JSON.stringify(second.events)).not.toContain('ana@example.com');
  });

  it('4096 unidades con un par de sustitutos al final se emite y 4097 no', async () => {
    expect((await emit(`${A(4094)}😀`)).status).toBe('waiting');
    const over = await emit(`${A(4095)}😀`);
    expect(over.events.map((e) => e.type)).toEqual(['llm', 'end']);
    expect(llmEvents(over)[0]).toMatchObject({ reason: 'invalid_turn' });
  });

  it('el límite se mide recortado: 4096 con miles de espacios alrededor se emite', async () => {
    const result = await emit(`${' '.repeat(10000)}${A(4096)}${'\n'.repeat(10000)}`);
    expect(result.status).toBe('waiting');
  });

  it.each([
    ['U+0000 en medio', 'a\u0000b'],
    ['U+0000 al principio', '\u0000a'],
    ['sustituto bajo suelto al principio', '\udc00a'],
    ['sustituto alto suelto al final', 'a\ud83d'],
    ['dos sustitutos altos', '\ud83d\ud83d'],
    ['un 4097 con U+0000 al final', `${A(4097)}\u0000`],
  ])('texto que no se puede emitir (%s) sale por invalid_turn y no llega a ningún evento ni al estado', async (_label, text) => {
    const result = await begin(llmFlow(), alwaysLlm(turn(text, { email: 'ana@example.com' }, true, 0.5)).host);
    expect(result.events.map((e) => e.type)).toEqual(['llm', 'end']);
    expect(llmEvents(result)[0]).toEqual({ type: 'llm', nodeId: 'a', turns: 1, costUsd: 0.5, reason: 'invalid_turn' });
    // Un turno descartado no aporta slots, aunque traiga done y el email.
    expect(result.state.contact.email).toBeNull();
  });

  it('un asistente que repite siempre el mismo texto no se rompe: 3 turnos y salida por max_turns', async () => {
    const results = await chat(llmFlow(), alwaysLlm(turn('Igual')).host, ['uno', 'dos']);
    expect(llmEvents(results[2]!)[0]).toMatchObject({ turns: 3, reason: 'max_turns' });
  });
});

describe('Llamadas al host de una operación', () => {
  it('dos llm seguidos hacen una llamada cada uno y el segundo no ve la conversación del primero', async () => {
    const flow = llmFlow(
      {},
      {
        nodes: [
          { id: 'a', type: 'llm', provider: 'principal', goal: 'uno', slots: [{ variable: 'email', description: 'e' }], next: 'c', onExhausted: 'ko' },
          { id: 'c', type: 'llm', provider: 'principal', goal: 'dos', slots: [{ variable: 'nombre', description: 'n' }], next: 'ok', onExhausted: 'ko' },
          { id: 'ok', type: 'end', outcome: 'ok' },
          { id: 'ko', type: 'end', outcome: 'ko' },
        ],
      },
    );
    const llm = scriptedLlm([turn('Primero', { email: 'ana@example.com' }, true), turn('Segundo', { nombre: 'Ana' }, true)]);
    const result = await begin(flow, llm.host);
    expect(result.status).toBe('ended');
    expectLlmScript(llm, 2);
    expect(llm.requests[1]).toMatchObject({ nodeId: 'c', turn: 1, history: [] });
    expect(llm.requests[1]!.slots.map((s) => [s.name, s.collected])).toEqual([['nombre', false]]);
  });
});
