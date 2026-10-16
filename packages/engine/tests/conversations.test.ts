import { afterEach, describe, expect, it, vi } from 'vitest';
import { continueSession, startSession, type AdvanceResult, type SessionResult } from '../src/index.js';
import { converse } from './helpers/conversation.js';
import { readExample, readFixture } from './helpers/files.js';
import { deepFreeze, end, flowOf, input, variable } from './helpers/flows.js';

const MARK = 'ZQXJ-8f3a-marcador';

/** Un flujo con un input de cada tipo (maxRetries alto) y un end que no renderiza nada. */
const everyType = () =>
  flowOf(
    [
      input('t-text', 't', 'text', 't-email'),
      input('t-email', 'e', 'email', 't-phone', { validation: { maxRetries: 5 } }),
      input('t-phone', 'p', 'phone', 't-number', { validation: { maxRetries: 5 } }),
      input('t-number', 'n', 'number', 't-url', { validation: { maxRetries: 5, min: 0, max: 100 } }),
      input('t-url', 'u', 'url', 't-date', { validation: { maxRetries: 5 } }),
      input('t-date', 'd', 'date', 't-bool', { validation: { maxRetries: 5 } }),
      input('t-bool', 'b', 'boolean', 't-choice', { validation: { maxRetries: 5 } }),
      input('t-choice', 'c', 'choice', 'fin', {
        multiple: true,
        choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', value: 2 }],
        validation: { min: 1, max: 1, maxRetries: 5 },
      }),
      end('fin', { outcome: 'listo' }),
    ],
    { variables: ['t', 'e', 'p', 'n', 'u', 'd', 'b', 'c'].map((name) => variable(name, { pii: true })) },
  );

type Conversation = { label: string; flow: unknown; steps: unknown[]; contact?: unknown };

const conversations: Conversation[] = [
  {
    label: 'captacion-leads completa',
    flow: readExample('captacion-leads'),
    steps: [{ text: ' Ana ' }, { text: 'ana@' }, { text: 'ana@example.com' }, { choice: 'grande' }],
  },
  {
    label: 'captacion-leads agotada con un rechazo',
    flow: readExample('captacion-leads'),
    steps: [{ text: 'Ana' }, { choice: 'x' }, { text: 'a' }, { text: 'b' }, { text: 'c' }],
  },
  {
    label: 'seleccion-multiple',
    flow: readFixture('seleccion-multiple'),
    steps: [{ choices: [] }, { choices: ['b', 'a'] }],
  },
  {
    label: 'un input de cada tipo con respuestas inválidas intercaladas',
    flow: everyType(),
    steps: [
      { text: "texto" },
      { text: MARK }, { text: 'ana@example.com' },
      { text: MARK }, { text: '600 123 456' },
      { text: MARK }, { text: '500' }, { text: '42,5' },
      { text: MARK }, { text: 'example.com/precios' },
      { text: MARK }, { text: '2026-10-16' },
      { text: MARK }, { text: 'sí' },
      { choices: [] }, { choices: ['a', 'b'] }, { choices: ['b'] },
    ],
  },
  {
    label: 'agotar cada tipo',
    flow: flowOf([input('p', 'v', 'number', 'fin', { validation: { maxRetries: 2 } }), end('fin')], { variables: [variable('v')] }),
    steps: [{ text: MARK }, { text: MARK }, { text: MARK }],
  },
];

const every = (result: AdvanceResult[]): SessionResult[] => result.filter((r): r is SessionResult => r.ok);
const maxRetriesOf = (flow: unknown, nodeId: string): number => {
  const node = (flow as { nodes: { id: string; validation?: { maxRetries?: number } }[] }).nodes.find((n) => n.id === nodeId);
  return node?.validation?.maxRetries ?? 3;
};

describe('propiedades sobre conversaciones', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(conversations.map((c) => [c.label, c] as const))('%s: determinismo', async (_label, c) => {
    expect(await converse(structuredClone(c.flow), c.steps, c.contact)).toEqual(await converse(structuredClone(c.flow), c.steps, c.contact));
  });

  it.each(conversations.map((c) => [c.label, c] as const))('%s: ida y vuelta por JSON entre pausas', async (_label, c) => {
    const direct = await converse(c.flow, c.steps, c.contact);
    let state: unknown;
    const viaJson: AdvanceResult[] = [await startSession({ flow: c.flow, contact: c.contact })];
    state = viaJson[0]!.ok ? JSON.parse(JSON.stringify((viaJson[0] as SessionResult).state)) : undefined;
    for (const step of c.steps) {
      const result = await continueSession({ flow: c.flow, state, input: step });
      viaJson.push(result);
      if (result.ok) state = JSON.parse(JSON.stringify(result.state));
    }
    expect(viaJson).toEqual(direct);
  });

  it.each(conversations.map((c) => [c.label, c] as const))('%s: entradas congeladas y sin cambios', async (_label, c) => {
    const flow = deepFreeze(structuredClone(c.flow));
    const steps = deepFreeze(structuredClone(c.steps));
    const results: AdvanceResult[] = [await startSession({ flow })];
    let last = results[0] as SessionResult;
    for (const step of steps) {
      const state = deepFreeze(structuredClone(last.state));
      const result = await continueSession({ flow, state, input: step });
      expect(state).toEqual(last.state);
      if (result.ok) last = result;
    }
    expect(flow).toEqual(c.flow);
    expect(steps).toEqual(c.steps);
  });

  it.each(conversations.map((c) => [c.label, c] as const))('%s: un único evento terminal y siempre el último', async (_label, c) => {
    for (const result of every(await converse(c.flow, c.steps, c.contact))) {
      const terminals = result.events.filter((e) => e.type === 'end' || e.type === 'error' || e.type === 'input');
      expect(terminals).toHaveLength(1);
      expect(result.events.at(-1)).toBe(terminals[0]);
      const type = terminals[0]!.type;
      expect(result.status).toBe(type === 'input' ? 'waiting' : type === 'end' ? 'ended' : 'failed');
    }
  });

  it.each(conversations.map((c) => [c.label, c] as const))('%s: attempt ≤ maxRetries + 1', async (_label, c) => {
    for (const result of every(await converse(c.flow, c.steps, c.contact))) {
      for (const event of result.events) {
        if (event.type === 'input') expect(event.attempt).toBeLessThanOrEqual(maxRetriesOf(c.flow, event.nodeId) + 1);
      }
      if (result.status === 'waiting') expect(result.state.attempt).toBeGreaterThanOrEqual(1);
    }
  });

  it('no fuga: una respuesta inválida con un marcador único no aparece en ningún evento, estado ni rechazo', async () => {
    const leaks: string[] = [];
    for (const c of conversations) {
      const results = await converse(c.flow, c.steps, c.contact);
      results.forEach((result, i) => {
        const invalidStep = i > 0 && JSON.stringify(c.steps[i - 1]).includes(MARK);
        const accepted = result.ok && result.events.some((e) => e.type === 'input' && e.reason !== null);
        if ((invalidStep && (accepted || !result.ok)) || (result.ok && result.state.error?.code === 'retries_exhausted')) {
          if (JSON.stringify(result).includes(MARK)) leaks.push(`${c.label} paso ${i}`);
        }
      });
    }
    expect(leaks).toEqual([]);
  });

  it('no fuga: un rechazo invalid_input no contiene la entrada', async () => {
    const flow = readExample('captacion-leads');
    const first = (await startSession({ flow })) as SessionResult;
    for (const bad of [{ text: 5, [MARK]: 1 }, { choice: MARK }, MARK, { [MARK]: MARK }]) {
      const result = await continueSession({ flow, state: first.state, input: bad });
      expect(JSON.stringify(result)).not.toContain(MARK);
    }
  });

  it('una respuesta válida solo aparece en su variable', async () => {
    const flow = flowOf([input('p', 'v', 'text', 'fin'), end('fin')], { variables: [variable('v')] });
    const [, answered] = (await converse(flow, [{ text: MARK }])) as SessionResult[];
    expect(JSON.stringify(answered!.events)).not.toContain(MARK);
    expect(JSON.stringify({ ...answered!.state, variables: {} })).not.toContain(MARK);
    expect(answered!.state.variables.v).toBe(MARK);
  });

  it('ningún método de console se llama (espera, reintenta, se rechaza, termina y falla)', async () => {
    const spies = (Object.keys(console) as (keyof Console)[])
      .filter((key) => typeof console[key] === 'function')
      .map((key) => vi.spyOn(console, key as 'log').mockImplementation(() => {}));
    for (const c of conversations) await converse(c.flow, c.steps, c.contact);
    expect(spies.length).toBeGreaterThan(5);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('las conversaciones ejercitan todos los tipos de input', async () => {
    const seen = new Set<string>();
    for (const c of conversations) {
      for (const result of every(await converse(c.flow, c.steps, c.contact))) {
        for (const e of result.events) if (e.type === 'input') seen.add(e.inputType);
      }
    }
    expect([...seen].sort()).toEqual(['boolean', 'choice', 'date', 'email', 'number', 'phone', 'text', 'url']);
  });
});
