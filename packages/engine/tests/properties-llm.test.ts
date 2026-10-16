import { afterEach, describe, expect, it, vi } from 'vitest';
import { continueSession, startSession, type AdvanceResult, type EngineHost, type SessionResult, type SessionState } from '../src/index.js';
import { readExample } from './helpers/files.js';
import { deepFreeze, end, input, llmFlow, llmNode, variable, type Obj } from './helpers/flows.js';
import { always, respond } from './helpers/http-host.js';
import { alwaysLlm, scriptedLlm, turn, withHosts } from './helpers/llm-host.js';
import { begin, chat, proceed } from './helpers/llm-run.js';
import { prng } from './helpers/regex.js';

/**
 * Flujos con un `llm` y hosts y usuarios al azar. Se comprueban invariantes, no valores: la promesa
 * nunca se rechaza, el estado es JSON y se puede continuar, hay un único evento terminal y siempre es
 * el último, el host recibe como mucho una llamada por operación y ningún marcador sensible aparece
 * en eventos, errores ni estado (salvo, en el estado de una espera, lo que escribió el usuario).
 */
const DNI = 'MARCA-DNI';
const INVALID = 'MARCA-INVALIDA';
const TURN_TEXT = 'MARCA-TURNO';
const FOREIGN = 'SLOT-AJENO';
const HOST_ERROR = 'MARCA-ERROR';
const CONVERSATION = 'MARCA-CONVERSACION';

const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

const TEXTS = ['Hola', '  ¿Me das tu email?  ', 'Tu email es {{email}}', `${TURN_TEXT}\u0000`, `${TURN_TEXT}\ud800`, '   ', 'a'.repeat(4097), 'a'.repeat(4096), 'ñandú 😀'];
const SLOT_SETS: unknown[] = [
  {},
  { email: 'ana@example.com' },
  { email: `${INVALID}@` },
  { email: null, nombre: 'Ana' },
  { email: 'ana@example.com', nombre: FOREIGN, admin: true },
  { [FOREIGN]: 'x' },
  { email: 5 },
  { email: ['a@b.co'] },
  { nombre: `${INVALID}\u0000` },
  JSON.parse('{"email": "ana@example.com", "__proto__": {"nombre": "SLOT-AJENO"}}'),
  Object.create({ email: `${FOREIGN}@example.com` }),
  [],
];
const COSTS = [0, 0.01, 0.02, 0.03, 0.2, 1000];
const MESSAGES: unknown[] = ['Hola', `Mi DNI es ${DNI}`, `${CONVERSATION} ${DNI}`, '   ', 'a'.repeat(4097), 'x\u0000', 'ana@example.com', 'Sí', 5, { choice: 'x' }];

function hostStep(rand: () => number): unknown {
  if (rand() < 0.6) {
    return { kind: 'turn', text: pick(rand, TEXTS), slots: pick(rand, SLOT_SETS), done: rand() < 0.4, costUsd: pick(rand, COSTS), usage: { note: HOST_ERROR } };
  }
  switch (Math.floor(rand() * 10)) {
    case 0:
      return { kind: 'refusal', costUsd: pick(rand, COSTS) };
    case 1:
      return { kind: 'failed', costUsd: pick(rand, COSTS) };
    case 2:
      return { kind: 'not_configured' };
    case 3:
      return () => {
        throw new Error(`${HOST_ERROR} ${DNI}`);
      };
    case 4:
      return () => Promise.reject(new Error(`${HOST_ERROR} ${DNI}`));
    case 5:
      return null;
    case 6:
      return { kind: 'otro', text: HOST_ERROR };
    case 7:
      return new Proxy({ kind: 'turn' }, { get: () => { throw new Error(HOST_ERROR); } });
    case 8:
      return { kind: 'turn', text: 'x', slots: pick(rand, SLOT_SETS), done: 'sí', costUsd: -1 };
    default:
      return { kind: 'turn', text: 'x', slots: pick(rand, SLOT_SETS), done: true, costUsd: 0.01 };
  }
}

/** Una variante de flujo al azar. */
function flowFor(rand: () => number): Obj {
  switch (Math.floor(rand() * 5)) {
    case 0:
      return llmFlow();
    case 1:
      return llmFlow({ maxTurns: 1 + Math.floor(rand() * 4), costCapUsd: pick(rand, [0.01, 0.05, 0.5]) });
    case 2:
      return llmFlow({}, { nodes: [llmNode({ next: 'a' }), end('ko', { outcome: 'ko' })] });
    case 3:
      return llmFlow({}, { nodes: [llmNode({ slots: undefined, next: 'p' }), input('p', 'nombre', 'text', 'ok'), end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })] });
    default:
      return readExample('faq-ia') as Obj;
  }
}

function hostFor(rand: () => number): { host: EngineHost; calls: () => number } {
  const steps = Array.from({ length: 12 }, () => hostStep(rand));
  let calls = 0;
  const llm = (async () => {
    const step = steps[calls++ % steps.length];
    return typeof step === 'function' ? (step as () => unknown)() : step;
  }) as unknown as EngineHost['llm'];
  return { host: { llm, http: always(respond(200, '{"id":"T-1"}')).host.http }, calls: () => calls };
}

const text = (value: unknown): string => JSON.stringify(value);

describe('propiedades sobre conversaciones llm con hosts y usuarios al azar', () => {
  afterEach(() => vi.restoreAllMocks());

  it('300 conversaciones: la promesa nunca se rechaza, el estado es JSON, un único terminal y nada sensible se filtra', async () => {
    const rand = prng(20261020);
    let waiting = 0;
    let failed = 0;
    let ended = 0;
    let rejected = 0;
    for (let i = 0; i < 300; i++) {
      const flow = flowFor(rand);
      const { host, calls } = hostFor(rand);
      let state: SessionState | undefined;
      for (let op = 0; op < 8; op++) {
        const before = calls();
        let result: AdvanceResult;
        try {
          result =
            state === undefined
              ? await startSession({ flow, contact: { email: 'previo@example.com' } }, host)
              : await continueSession({ flow, state: JSON.parse(JSON.stringify(state)), input: pick(rand, MESSAGES) }, host);
        } catch (error) {
          throw new Error(`la promesa se rechazó (${String(error)}) con ${text(flow)}`);
        }
        if (!result.ok) {
          expect(result.code, text(result)).toBe('invalid_input');
          rejected++;
          continue;
        }
        expect(calls() - before, 'llamadas al host llm en una operación').toBeLessThanOrEqual(1);
        const done = result as SessionResult;
        expect(JSON.parse(JSON.stringify(done.state))).toEqual(done.state);
        const terminal = done.events.filter((e) => e.type === 'input' || e.type === 'end' || e.type === 'error');
        expect(terminal.length).toBeLessThanOrEqual(1);
        if (terminal.length === 1) expect(done.events.at(-1)).toBe(terminal[0]);
        if (done.status === 'waiting') expect(done.events.at(-1)?.type).toBe('input');
        // Nada del host ni de los descartes llega a eventos ni a errores.
        const visible = text([done.events.filter((e) => e.type !== 'message'), done.state.error, done.state.nodeId]);
        for (const marker of [HOST_ERROR, DNI, INVALID, TURN_TEXT, FOREIGN, CONVERSATION]) expect(visible, marker).not.toContain(marker);
        expect(text(done.events), 'mensajes del usuario en eventos').not.toContain(DNI);
        // El estado, sin la conversación, no contiene nada de lo que escribió el usuario ni de lo descartado.
        const { conversation, ...rest } = done.state;
        for (const marker of [HOST_ERROR, DNI, INVALID, TURN_TEXT, FOREIGN, CONVERSATION]) expect(text(rest), marker).not.toContain(marker);
        for (const marker of [HOST_ERROR, INVALID, TURN_TEXT, FOREIGN]) expect(text(conversation ?? null), marker).not.toContain(marker);
        if (done.status === 'waiting') {
          waiting++;
          // La conversación está en el estado exactamente cuando se espera en un llm.
          const waitingType = (flow.nodes as { id: string; type: string }[]).find((n) => n.id === done.state.nodeId)!.type;
          expect(conversation !== undefined, `espera en ${waitingType}`).toBe(waitingType === 'llm');
          state = done.state;
        } else {
          expect(conversation).toBeUndefined();
          if (done.status === 'failed') failed++;
          else ended++;
          break;
        }
      }
    }
    expect(waiting).toBeGreaterThan(60);
    expect(failed).toBeGreaterThan(30);
    expect(ended).toBeGreaterThan(30);
    expect(rejected).toBeGreaterThan(10);
  });

  it('determinismo: el mismo guion da los mismos resultados y las mismas peticiones', async () => {
    for (let i = 0; i < 80; i++) {
      const outcomes = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const rand = prng(500 + i);
        const flow = flowFor(rand);
        const steps = Array.from({ length: 12 }, () => hostStep(rand));
        const seen: unknown[] = [];
        let calls = 0;
        const host: EngineHost = {
          llm: (async (request: unknown) => {
            seen.push(structuredClone(request));
            const step = steps[calls++ % steps.length];
            return typeof step === 'function' ? (step as () => unknown)() : step;
          }) as unknown as EngineHost['llm'],
          http: always(respond(200, '{}')).host.http,
        };
        const results: AdvanceResult[] = [await startSession({ flow }, host)];
        for (let op = 0; op < 3; op++) {
          const last = results.at(-1)!;
          if (!last.ok || last.status !== 'waiting') break;
          results.push(await continueSession({ flow, state: last.state, input: { text: `mensaje ${op}` } }, host));
        }
        outcomes.push({ results, seen });
      }
      expect(JSON.stringify(outcomes[0]!.results)).toBe(JSON.stringify(outcomes[1]!.results));
      expect(outcomes[0]!.seen).toEqual(outcomes[1]!.seen);
    }
  });

  it('entradas congeladas: flujo, estado, mensaje y resultados del host no cambian', async () => {
    const rand = prng(9);
    for (let i = 0; i < 80; i++) {
      const flow = deepFreeze(structuredClone(flowFor(rand)));
      // Un Proxy no se puede congelar (sus trampas lanzan): ese paso se deja tal cual.
      const steps = Array.from({ length: 6 }, () => {
        const step = hostStep(rand);
        try {
          return deepFreeze(step);
        } catch {
          return step;
        }
      });
      let calls = 0;
      const host: EngineHost = {
        llm: (async () => {
          const step = steps[calls++ % steps.length];
          return typeof step === 'function' ? (step as () => unknown)() : step;
        }) as unknown as EngineHost['llm'],
        http: always(respond(200, '{}')).host.http,
      };
      const first = await startSession({ flow, contact: deepFreeze({ email: 'previo@example.com' }) }, host);
      expect(first.ok).toBe(true);
      if (!first.ok || first.status !== 'waiting') continue;
      const state = deepFreeze(structuredClone(first.state));
      const message = deepFreeze({ text: 'Hola' });
      const snapshot = [structuredClone(state), structuredClone(message)];
      const second = await continueSession({ flow, state, input: message }, host);
      expect(second.ok).toBe(true);
      expect([state, message]).toEqual(snapshot);
    }
  });

  it('ningún método de console se llama en conversaciones que terminan, se agotan y fallan', async () => {
    const spies = (Object.keys(console) as (keyof Console)[])
      .filter((key) => typeof console[key] === 'function')
      .map((key) => vi.spyOn(console, key as 'log').mockImplementation(() => {}));
    const rand = prng(3);
    for (let i = 0; i < 100; i++) {
      const { host } = hostFor(rand);
      const result = await startSession({ flow: flowFor(rand) }, host);
      if (result.ok && result.status === 'waiting') await continueSession({ flow: flowFor(rand), state: result.state, input: { text: 'Hola' } }, host);
    }
    expect(spies.length).toBeGreaterThan(5);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('recoger un json de 100 niveles, pasar el estado por JSON y continuar no se rechaza', async () => {
    let deep: unknown = [];
    for (let i = 1; i < 100; i++) deep = [deep];
    const flow = llmFlow(
      { slots: [{ variable: 'datos', description: 'd' }], maxTurns: 5 },
      { variables: [variable('datos', { type: 'json' }), variable('nombre')] },
    );
    const llm = scriptedLlm([turn('uno', { datos: deep }), turn('dos', {}, true)]);
    const first = await begin(flow, llm.host);
    expect(first.status).toBe('waiting');
    expect(first.state.conversation?.collected.datos).toEqual(deep);
    const roundTrip = JSON.parse(JSON.stringify(first.state)) as SessionState;
    const second = await proceed(flow, roundTrip, 'Hola', llm.host);
    expect(second.status).toBe('ended');
    expect(second.state.variables.datos).toEqual(deep);
  });

  it('el mismo flujo con un host que reparte marcadores en sus resultados no filtra al estado de una sesión terminada', async () => {
    const llm = alwaysLlm({ kind: 'turn', text: 'Gracias', slots: { email: 'ana@example.com', nombre: FOREIGN }, done: true, costUsd: 0.01, extra: HOST_ERROR });
    const { host } = withHosts(always(respond(200)).host, llm.host);
    const [result] = await chat(llmFlow(), host, []);
    expect(text([result!.events, result!.state])).not.toContain(FOREIGN);
    expect(text([result!.events, result!.state])).not.toContain(HOST_ERROR);
  });
});
