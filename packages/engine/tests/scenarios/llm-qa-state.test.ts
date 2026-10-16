import { describe, expect, it } from 'vitest';
import { continueSession, startSession, type SessionResult } from '../../src/index.js';
import { end, httpNode, llmFlow, llmNode, variable } from '../helpers/flows.js';
import { always, respond } from '../helpers/http-host.js';
import { alwaysLlm, expectLlmScript, failed, refusal, scriptedLlm, turn, withHosts } from '../helpers/llm-host.js';
import { begin, expectFailed, llmEvents, proceed } from '../helpers/llm-run.js';

/**
 * QA independiente de la feature 4: gasto acotado (turnos, coste y llamadas externas) con estados
 * manipulados y privacidad de lo que sale del nodo. Los escapes `\uXXXX` evitan caracteres
 * invisibles en el fichero.
 */

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('Presupuesto de 10 llamadas externas compartido entre http y llm', () => {
  /** `before` http de 1 intento, el llm `a` (next → `after` http, luego el llm `b`). */
  const chain = (httpAfter: number, extraA: Record<string, unknown> = {}, retries = 0) => {
    const link = (prefix: string, count: number, then: string) =>
      Array.from({ length: count }, (_, i) =>
        httpNode(`${prefix}${i}`, {}, { retries, next: i + 1 < count ? `${prefix}${i + 1}` : then, onError: i + 1 < count ? `${prefix}${i + 1}` : then }),
      );
    const nodes = [
      llmNode({ next: httpAfter > 0 ? 'h0' : 'b', ...extraA }),
      ...link('h', httpAfter, 'b'),
      llmNode({ next: 'ok' }, 'b'),
      end('ok', { outcome: 'ok' }),
      end('ko', { outcome: 'ko' }),
    ];
    return llmFlow({}, { nodes });
  };
  const done = turn('Listo', { email: 'ana@example.com' }, true);

  it('un llm, ocho http y otro llm caben exactamente en 10 llamadas', async () => {
    const llm = scriptedLlm([done, turn('Segundo', {}, false)]);
    const http = always(respond(200));
    const { host } = withHosts(http.host, llm.host);
    const result = await begin(chain(8), host);
    expect(result.status).toBe('waiting');
    expect(result.state.nodeId).toBe('b');
    expect(http.requests).toHaveLength(8);
    expectLlmScript(llm, 2);
  });

  it('con nueve http el segundo llm sería la llamada 11: falla en b sin llamarlo y deja el evento llm de a', async () => {
    const llm = scriptedLlm([done, turn('Segundo', {}, false)]);
    const http = always(respond(200));
    const { host } = withHosts(http.host, llm.host);
    const result = await begin(chain(9), host);
    expectFailed(result, 'llm_limit_exceeded', 'b');
    expect(llmEvents(result)).toHaveLength(1);
    expect(http.requests).toHaveLength(9);
    expect(llm.requests).toHaveLength(1);
  });

  it('los reintentos de http gastan el mismo presupuesto: 4 http de 3 intentos agotan las 10 llamadas y el llm no se hace', async () => {
    const flow = llmFlow({}, {
      nodes: [
        ...Array.from({ length: 4 }, (_, i) => httpNode(`h${i}`, {}, { retries: 2, next: i < 3 ? `h${i + 1}` : 'a', onError: i < 3 ? `h${i + 1}` : 'a' })),
        llmNode(),
        end('ok', { outcome: 'ok' }),
        end('ko', { outcome: 'ko' }),
      ],
    });
    const llm = alwaysLlm(turn('Hola'));
    const http = always(respond(503));
    const { host } = withHosts(http.host, llm.host);
    const result = await begin(flow, host);
    expect(http.requests.length + llm.requests.length).toBeLessThanOrEqual(10);
    expect(http.requests).toHaveLength(10);
    expectFailed(result, 'llm_limit_exceeded', 'a');
    expect(llm.requests).toHaveLength(0);
  });

  it('la continuación cuenta su propio turno: turno + 9 http caben y un décimo http no', async () => {
    const llm = scriptedLlm([turn('Hola', {}, false), done]);
    const http = always(respond(200));
    const { host } = withHosts(http.host, llm.host);
    const flow = chain(9);
    const first = await begin(flow, host);
    expect(first.status).toBe('waiting');
    expect(http.requests).toHaveLength(0);
    const second = await proceed(flow, first.state, 'Hola', host);
    // Turno de a (1) + 9 http (10): el llm `b` ya no cabe.
    expectFailed(second, 'llm_limit_exceeded', 'b');
    expect(http.requests).toHaveLength(9);
    expect(llm.requests).toHaveLength(2);
  });
});

describe('Estados manipulados al reanudar un llm', () => {
  const flow = (extra: Record<string, unknown> = {}) => llmFlow({ maxTurns: 3, costCapUsd: 0.05, ...extra });
  const conversation = (messages: number, costUsd: number, collected: Record<string, unknown> = {}) => ({
    messages: Array.from({ length: messages }, (_, i) => ({ role: i % 2 === 0 ? 'assistant' : 'user', text: `m${i}` })),
    costUsd,
    collected,
  });
  const waiting = async (extra: Record<string, unknown> = {}) => {
    const f = flow(extra);
    const first = await begin(f, alwaysLlm(turn('Hola', {}, false, 0.01)).host);
    return { f, state: first.state };
  };
  const resume = async (f: unknown, state: unknown, host = alwaysLlm(turn('Otra', {}, false, 0.01))) => ({
    result: await continueSession({ flow: f, state, input: { text: 'hola' } }, host.host),
    host,
  });

  it('un estado con tres turnos de mensajes y coste 0 sale por max_turns sin llamar al host', async () => {
    const { f, state } = await waiting();
    const { result, host } = await resume(f, { ...state, conversation: conversation(5, 0) });
    expect(result).toMatchObject({ ok: true, status: 'ended' });
    expect(llmEvents(result as SessionResult)[0]).toMatchObject({ turns: 3, costUsd: 0, reason: 'max_turns' });
    expect(host.requests).toHaveLength(0);
  });

  it('un estado con el coste en el tope sale por cost_cap sin llamar al host, aunque tenga un solo mensaje', async () => {
    const { f, state } = await waiting();
    const { result, host } = await resume(f, { ...state, conversation: conversation(1, 0.05) });
    expect(llmEvents(result as SessionResult)[0]).toMatchObject({ turns: 1, costUsd: 0.05, reason: 'cost_cap' });
    expect(host.requests).toHaveLength(0);
  });

  it('un coste enorme pero finito en el estado sin tope de coste no revienta: o sale por tope o falla como host', async () => {
    const { f, state } = await waiting({ costCapUsd: undefined });
    const { result, host } = await resume(f, { ...state, conversation: conversation(1, Number.MAX_VALUE) }, alwaysLlm(turn('Otra', {}, false, Number.MAX_VALUE)));
    expectFailed(result as SessionResult, 'llm_host_error', 'a');
    expect(host.requests).toHaveLength(1);
  });

  it.each([
    ['conversation null', null],
    ['conversation vacía', {}],
    ['sin mensajes', { messages: [], costUsd: 0, collected: {} }],
    ['coste -0.01', { ...({ messages: [{ role: 'assistant', text: 'x' }], collected: {} }), costUsd: -0.01 }],
    ['coste NaN en memoria', { messages: [{ role: 'assistant', text: 'x' }], collected: {}, costUsd: Number.NaN }],
    ['coste Infinity en memoria', { messages: [{ role: 'assistant', text: 'x' }], collected: {}, costUsd: Infinity }],
    ['coste string', { messages: [{ role: 'assistant', text: 'x' }], collected: {}, costUsd: '0' }],
    ['roles sin alternar', { messages: [{ role: 'assistant', text: 'x' }, { role: 'assistant', text: 'y' }, { role: 'assistant', text: 'z' }], collected: {}, costUsd: 0 }],
    ['empieza por el usuario', { messages: [{ role: 'user', text: 'x' }], collected: {}, costUsd: 0 }],
    ['rol desconocido', { messages: [{ role: 'system', text: 'x' }], collected: {}, costUsd: 0 }],
    ['texto vacío', { messages: [{ role: 'assistant', text: '' }], collected: {}, costUsd: 0 }],
    ['texto de 4097', { messages: [{ role: 'assistant', text: 'a'.repeat(4097) }], collected: {}, costUsd: 0 }],
    ['texto con U+0000', { messages: [{ role: 'assistant', text: 'a\u0000' }], collected: {}, costUsd: 0 }],
    ['texto con sustituto suelto', { messages: [{ role: 'assistant', text: 'a\ud800' }], collected: {}, costUsd: 0 }],
    ['texto no string', { messages: [{ role: 'assistant', text: 5 }], collected: {}, costUsd: 0 }],
    ['mensaje no objeto', { messages: ['x'], collected: {}, costUsd: 0 }],
    ['mensajes no array', { messages: { 0: { role: 'assistant', text: 'x' }, length: 1 }, collected: {}, costUsd: 0 }],
    ['termina en el usuario (2 mensajes)', conversation(2, 0)],
    ['termina en el usuario (4 mensajes)', conversation(4, 0)],
    ['101 mensajes', conversation(101, 0)],
    ['100 mensajes', conversation(100, 0)],
    ['collected array', { messages: [{ role: 'assistant', text: 'x' }], collected: [], costUsd: 0 }],
    ['collected con null', { messages: [{ role: 'assistant', text: 'x' }], collected: { email: null }, costUsd: 0 }],
    ['collected null', { messages: [{ role: 'assistant', text: 'x' }], collected: null, costUsd: 0 }],
  ])('estado corrupto (%s) se rechaza con invalid_state sin llamar al host ni filtrar', async (_label, bad) => {
    const { f, state } = await waiting();
    const { result, host } = await resume(f, { ...state, conversation: bad });
    expect(result).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(host.requests).toHaveLength(0);
  });

  it('un rechazo por estado corrupto no repite ningún texto del estado', async () => {
    const { f, state } = await waiting();
    const bad = { messages: [{ role: 'assistant', text: 'MARCA-ESTADO\u0000' }], collected: { email: 'MARCA-SLOT@example.com' }, costUsd: -1 };
    const { result } = await resume(f, { ...state, conversation: bad });
    expect(result).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(JSON.stringify(result)).not.toContain('MARCA');
  });

  it('recogidos que ya no son slots del nodo, con tipo erróneo o con __proto__ se descartan y no contaminan', async () => {
    const { f, state } = await waiting();
    const collected = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": "x", "nombre": "no es slot", "email": 5}') as Record<string, unknown>;
    const { result } = await resume(f, { ...state, conversation: conversation(1, 0, collected) });
    const ok = result as SessionResult;
    expect(ok.status).toBe('waiting');
    expect(ok.state.conversation!.collected).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(ok.state.variables)).toEqual([]);
  });

  it('un recogido válido sobrevive a la reanudación y se guarda al salir', async () => {
    const f = llmFlow({ maxTurns: 3 });
    const state = { ...(await begin(f, alwaysLlm(turn('Hola')).host)).state };
    const host = alwaysLlm(turn('Gracias', {}, true));
    const result = (await continueSession({ flow: f, state: { ...state, conversation: conversation(1, 0, { email: ' Ana@Example.com ' }) }, input: { text: 'hola' } }, host.host)) as SessionResult;
    // Lo guardado en el estado ya debería venir convertido: un valor sin convertir se vuelve a convertir.
    expect(result.status).toBe('ended');
    expect(result.state.contact.email).toBe('Ana@example.com');
  });

  it('una conversación de otro nodo (con recogidos que este no declara) no pasa sus slots al nodo actual', async () => {
    const flow2 = llmFlow(
      {},
      {
        nodes: [
          llmNode({ slots: [{ variable: 'nombre', description: 'Nombre' }], next: 'b' }),
          llmNode({ slots: [{ variable: 'email', description: 'Email', required: false }], next: 'ok', maxTurns: 3 }, 'b'),
          end('ok', { outcome: 'ok' }),
          end('ko', { outcome: 'ko' }),
        ],
      },
    );
    const first = await begin(flow2, alwaysLlm(turn('Hola', {}, false)).host);
    expect(first.state.nodeId).toBe('a');
    // El estado dice que espera en `b` pero lleva lo recogido en `a`.
    const forged = { ...first.state, nodeId: 'b', conversation: conversation(1, 0, { nombre: 'Ana', email: 'ana@example.com' }) };
    const result = (await continueSession({ flow: flow2, state: forged, input: { text: 'hola' } }, alwaysLlm(turn('Fin', {}, true)).host)) as SessionResult;
    expect(result.status).toBe('ended');
    // `nombre` no es un slot de `b`: no se escribe; `email` sí lo es y se revalida.
    expect(result.state.variables.nombre).toBeUndefined();
    expect(result.state.contact.email).toBe('ana@example.com');
  });

  it('el estado de una espera pasa por JSON sin cambiar el resultado de la operación siguiente', async () => {
    const f = flow({ maxTurns: 6 });
    const script = () => scriptedLlm([turn('Uno', { email: 'ana@example.com' }, false, 0.01), turn('Dos', {}, false, 0.01)]);
    const a = script();
    const first = await begin(f, a.host);
    const direct = await proceed(f, first.state, 'x', a.host);
    const b = scriptedLlm([turn('Dos', {}, false, 0.01)]);
    const viaJson = await proceed(f, wire(first.state), 'x', b.host);
    expect(viaJson.events).toEqual(direct.events);
    expect(viaJson.state).toEqual(direct.state);
    expect(b.requests[0]).toEqual(a.requests[1]);
  });

  it('un estado profundamente congelado se acepta y no se modifica', async () => {
    const f = flow();
    const first = await begin(f, alwaysLlm(turn('Hola', { email: 'ana@example.com' })).host);
    const frozen = wire(first.state);
    const freeze = (value: unknown): void => {
      if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freeze);
      }
    };
    freeze(frozen);
    const copy = wire(frozen);
    const result = await proceed(f, frozen, 'hola', alwaysLlm(turn('Otra')).host);
    expect(result.status).toBe('waiting');
    expect(frozen).toEqual(copy);
  });
});

describe('Privacidad: lo que sale del nodo', () => {
  const USER = 'MARCA-USUARIO';
  const ASSISTANT = 'MARCA-ASISTENTE';
  const PII = 'marca.pii@example.com';
  const HOST_ERROR = 'MARCA-ERROR-HOST';
  const GOAL = 'MARCA-GOAL';
  const SYSTEM = 'MARCA-SYSTEM';

  const piiFlow = (extra: Record<string, unknown> = {}) =>
    llmFlow(
      { goal: `${GOAL} para {{nombre}}`, system: `${SYSTEM} {{nombre}}`, maxTurns: 2, costCapUsd: 0.05, ...extra },
      { variables: [variable('email', { type: 'email', scope: 'contact', pii: true }), variable('nombre', { pii: true, default: 'Ana' })] },
    );

  /** Todo lo que no es el `message` del asistente ni las variables del flujo. */
  const outside = (result: SessionResult): string => {
    const { variables, contact, ...rest } = result.state;
    void variables;
    void contact;
    return JSON.stringify([result.events.filter((e) => e.type !== 'message'), rest]);
  };

  const scenarios: [string, unknown[], (SessionResult | null)[] | null][] = [
    ['sale por next', [turn(`${ASSISTANT} 1`, { email: PII }, true, 0.01)], null],
    ['sale por max_turns', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.01), turn(`${ASSISTANT} 2`, {}, false, 0.01)], null],
    ['sale por cost_cap', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.06)], null],
    ['sale por refusal', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.01), refusal(0.01)], null],
    ['sale por provider_error', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.01), failed(0.01)], null],
    ['sale por invalid_turn', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.01), turn(`${ASSISTANT}\u0000`, { email: PII }, true, 0.01)], null],
    ['el host lanza un error con datos', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.01), () => { throw new Error(`${HOST_ERROR} ${USER} ${PII}`); }], null],
    ['el host rechaza con un objeto con datos', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.01), () => Promise.reject({ message: HOST_ERROR, text: USER, pii: PII })], null],
    ['el host devuelve un resultado roto con datos', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.01), { kind: 'turn', text: `${ASSISTANT}-ROTO`, slots: { email: PII }, done: 'si', costUsd: 0, extra: HOST_ERROR }], null],
    ['proveedor no configurado', [turn(`${ASSISTANT} 1`, { email: PII }, false, 0.01), { kind: 'not_configured' }], null],
  ];

  it.each(scenarios)('%s: ni eventos ni estado final contienen textos del usuario, del asistente, system, goal ni slots pii', async (_label, steps) => {
    const flow = piiFlow();
    const llm = scriptedLlm(steps as never[]);
    const first = await begin(flow, llm.host);
    let result = first;
    if (first.status === 'waiting') result = await proceed(flow, wire(first.state), `${USER} ${PII}`, llm.host);
    // Todo lo que sale de operaciones que no esperan: eventos distintos de `message` y estado salvo variables.
    const events = result.events.filter((e) => e.type !== 'message');
    for (const marker of [USER, ASSISTANT, HOST_ERROR, GOAL, SYSTEM, PII]) {
      expect(JSON.stringify(events), `eventos con ${marker}`).not.toContain(marker);
    }
    if (result.status !== 'waiting') {
      for (const marker of [USER, ASSISTANT, HOST_ERROR, GOAL, SYSTEM]) expect(JSON.stringify(result.state), `estado con ${marker}`).not.toContain(marker);
      expect(result.state.conversation).toBeUndefined();
      // El valor pii solo puede estar en las variables y en el contacto.
      expect(outside(result)).not.toContain(PII);
    }
    // El estado de la primera espera sí lleva la conversación, pero nunca system ni goal.
    for (const marker of [GOAL, SYSTEM, HOST_ERROR]) expect(JSON.stringify(first.state), `primer estado con ${marker}`).not.toContain(marker);
  });

  it('system y goal renderizados con datos personales no entran en el estado en espera', async () => {
    const llm = alwaysLlm(turn('Hola', {}, false));
    const first = await begin(piiFlow(), llm.host);
    expect(llm.requests[0]!.goal).toBe(`${GOAL} para Ana`);
    expect(JSON.stringify(first.state)).not.toContain(GOAL);
    expect(JSON.stringify(first.state)).not.toContain(SYSTEM);
    expect(JSON.stringify(first.events)).not.toContain(GOAL);
  });

  it('un mensaje de usuario inválido no se refleja en el evento input', async () => {
    const flow = piiFlow();
    const llm = alwaysLlm(turn('Hola'));
    const first = await begin(flow, llm.host);
    for (const text of [`${USER}\u0000`, `${USER}${'a'.repeat(5000)}`, '   ']) {
      const result = await proceed(flow, first.state, text, llm.host);
      expect(JSON.stringify(result)).not.toContain(USER);
    }
  });

  it('las formas incorrectas de la entrada no repiten lo enviado', async () => {
    const flow = piiFlow();
    const llm = alwaysLlm(turn('Hola'));
    const first = await begin(flow, llm.host);
    for (const input of [{ text: 5, marca: USER }, { choice: USER }, { text: USER, extra: PII }, USER]) {
      const result = await continueSession({ flow, state: first.state, input }, llm.host);
      expect(result).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(JSON.stringify(result)).not.toContain('MARCA');
    }
  });

  it('el evento error de un fallo del host lleva un mensaje fijo', async () => {
    const result = await begin(piiFlow(), { llm: (() => { throw new Error(`${HOST_ERROR} ${PII}`); }) as never });
    const error = result.events.at(-1);
    expect(error).toMatchObject({ type: 'error', code: 'llm_host_error', nodeId: 'a' });
    expect(JSON.stringify(result)).not.toContain(HOST_ERROR);
    expect(JSON.stringify(result)).not.toContain(PII);
  });
});

describe('startSession y continueSession no rechazan nunca por un host hostil', () => {
  it.each([
    ['lanza un valor primitivo', () => { throw 'texto'; }],
    ['lanza null', () => { throw null; }],
    ['lanza undefined', () => { throw undefined; }],
    ['rechaza con undefined', () => Promise.reject(undefined)],
    ['rechaza con un símbolo', () => Promise.reject(Symbol('x'))],
    ['devuelve una promesa que nunca se rechaza ni resuelve con un getter hostil', () => Promise.resolve({ get kind(): never { throw new Error('x'); } })],
  ])('el host %s: la sesión falla con llm_host_error', async (_label, behaviour) => {
    const result = await startSession({ flow: llmFlow() }, { llm: behaviour as never });
    expect(result).toMatchObject({ ok: true, status: 'failed' });
    expect((result as SessionResult).state.error).toEqual({ code: 'llm_host_error', nodeId: 'a' });
  });
});
