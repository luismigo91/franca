import { describe, expect, it } from 'vitest';
import { continueSession, startSession, type EngineEvent, type SessionResult } from '../../src/index.js';
import { end, llmFlow, llmNode } from '../helpers/flows.js';
import { scriptedLlm } from '../helpers/llm-host.js';
import { assistantMessage, llmEvent, waitingInput } from '../helpers/llm-run.js';

/**
 * Modelo de referencia escrito desde la spec (sin mirar el ejecutor): para miles de conversaciones al
 * azar (semilla fija) con resultados de host y mensajes de usuario de todo tipo, y con el estado
 * pasando por JSON entre operaciones, el motor tiene que producir exactamente los eventos, el estado
 * y el número de llamadas al host que el modelo calcula con sus propias cuentas de turnos y coste.
 */

/** Generador pseudoaleatorio determinista (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pick<T> = readonly T[];
const pick = <T>(random: () => number, items: Pick<T>): T => items[Math.floor(random() * items.length)]!;

const COSTS = [0, 0.01, 0.02, 0.0125, 0.03, 0.05, 0.2] as const;
const TEXTS = ['Hola', '  espacios  ', '{{email}} no se renderiza', '¡Perfecto!', '   ', 'a'.repeat(4096), 'a'.repeat(4097), 'nul\u0000', 'suelto\ud800', ` ${'b'.repeat(4096)} `] as const;
const EMAILS = ['ana@example.com', 'x@', null, undefined, 5, '  ana@example.com  '] as const;
const USER = [
  ['hola', null],
  ['  ', 'required'],
  ['a'.repeat(4097), 'too_long'],
  ['x\u0000y', 'invalid_format'],
  ['más datos', null],
] as const;

type HostResult =
  | { kind: 'turn'; text: string; email: unknown; done: boolean; costUsd: number }
  | { kind: 'refusal' | 'failed'; costUsd: number }
  | { kind: 'not_configured' }
  | { kind: 'broken' };

function hostResult(random: () => number): HostResult {
  const roll = random();
  if (roll < 0.62) return { kind: 'turn', text: pick(random, TEXTS), email: pick(random, EMAILS), done: random() < 0.4, costUsd: pick(random, COSTS) };
  if (roll < 0.74) return { kind: 'refusal', costUsd: pick(random, COSTS) };
  if (roll < 0.86) return { kind: 'failed', costUsd: pick(random, COSTS) };
  if (roll < 0.92) return { kind: 'not_configured' };
  return { kind: 'broken' };
}

function wire(result: HostResult): unknown {
  switch (result.kind) {
    case 'turn':
      return { kind: 'turn', text: result.text, slots: result.email === undefined ? {} : { email: result.email }, done: result.done, costUsd: result.costUsd };
    case 'refusal':
    case 'failed':
      return result;
    case 'not_configured':
      return result;
    case 'broken':
      return { kind: 'turn', text: 5, slots: {}, done: false, costUsd: 0 };
  }
}

/** ¿Lo recoge la conversión de un slot `email`? Solo un string con forma de email (recortado). */
const collectedEmail = (value: unknown): string | null => (typeof value === 'string' && value.trim() === 'ana@example.com' ? 'ana@example.com' : null);

/** El texto del asistente que se emite, o null si no se puede (spec «Texto del asistente que no se puede emitir»). */
function emittable(raw: string): string | null {
  const text = raw.trim();
  if (text === '' || text.length > 4096 || text.includes('\u0000') || /[\ud800-\udfff]/.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) return null;
  return text;
}

interface Config {
  maxTurns: number;
  costCapUsd: number | undefined;
  selfJump: boolean;
}

interface Model {
  turns: number;
  cost: number;
  email: string | null;
  /** Variable `email` fuera del nodo. */
  stored: string | null;
  messages: number;
}

type Terminal = { kind: 'wait' } | { kind: 'end'; node: 'ok' | 'ko' } | { kind: 'fail'; code: string };

function exhausted(model: Model, config: Config): 'max_turns' | 'cost_cap' | null {
  if (model.turns >= config.maxTurns) return 'max_turns';
  if (config.costCapUsd !== undefined && model.cost >= config.costCapUsd) return 'cost_cap';
  return null;
}

/** Un turno del modelo. Devuelve los eventos, el terminal y si llamó al host. */
function modelTurn(model: Model, config: Config, result: HostResult): { events: EngineEvent[]; terminal: Terminal } {
  const events: EngineEvent[] = [];
  const leave = (node: 'ok' | 'ko', reason: string | null): { events: EngineEvent[]; terminal: Terminal } => {
    if (model.email !== null) model.stored = model.email;
    events.push(llmEvent(model.turns, model.cost, reason) as EngineEvent);
    events.push({ type: 'end', nodeId: node, outcome: node } as EngineEvent);
    return { events, terminal: { kind: 'end', node } };
  };
  const before = exhausted(model, config);
  if (before !== null) return leave('ko', before);

  if (result.kind === 'not_configured') return { events, terminal: { kind: 'fail', code: 'llm_not_configured' } };
  if (result.kind === 'broken') return { events, terminal: { kind: 'fail', code: 'llm_host_error' } };

  model.turns++;
  model.cost += result.costUsd;
  if (result.kind === 'refusal') return leave('ko', 'refusal');
  if (result.kind === 'failed') return leave('ko', 'provider_error');
  if (result.kind !== 'turn') throw new Error('inalcanzable');

  const text = emittable(result.text);
  if (text === null) return leave('ko', 'invalid_turn');
  const email = collectedEmail(result.email);
  if (email !== null) model.email = email;
  events.push(assistantMessage(text) as EngineEvent);
  model.messages += 1;

  if (result.done && model.email !== null) {
    if (!config.selfJump) return leave('ok', null);
    model.stored = model.email;
    const spent = exhausted(model, config);
    if (spent !== null) return leave('ko', spent);
    events.push(llmEvent(model.turns, model.cost, null) as EngineEvent);
    events.push(waitingInput('a') as EngineEvent);
    return { events, terminal: { kind: 'wait' } };
  }
  const spent = exhausted(model, config);
  if (spent !== null) return leave('ko', spent);
  events.push(waitingInput('a') as EngineEvent);
  return { events, terminal: { kind: 'wait' } };
}

function runConversation(seed: number): Promise<void> {
  const random = rng(seed);
  const config: Config = {
    maxTurns: pick(random, [1, 2, 3, 5]),
    costCapUsd: pick(random, [undefined, 0.03, 0.05, 0.0125]),
    selfJump: random() < 0.35,
  };
  const model: Model = { turns: 0, cost: 0, email: null, stored: null, messages: 0 };
  const extra = { maxTurns: config.maxTurns, costCapUsd: config.costCapUsd };
  // Con autosalto `ok` sería inalcanzable: el flujo solo tiene `ko`.
  const flow = config.selfJump
    ? llmFlow({}, { nodes: [llmNode({ ...extra, next: 'a' }), end('ko', { outcome: 'ko' })] })
    : llmFlow(extra);
  const results: HostResult[] = [];
  const queue: HostResult[] = [];
  const host = scriptedLlm([(): unknown => wire(queue.shift()!)], { repeatLast: true });
  const label = `semilla ${seed} ${JSON.stringify(config)}`;

  return (async () => {
    let state: unknown = null;
    let attempt = 1;
    for (let op = 0; op < 12; op++) {
      let user: (typeof USER)[number] | null = null;
      if (op > 0) {
        user = pick(random, USER);
        if (user[1] !== null) {
          const before = host.requests.length;
          const result = (await continueSession({ flow, state: JSON.parse(JSON.stringify(state)), input: { text: user[0] } }, host.host)) as SessionResult;
          expect(result.events, label).toEqual([waitingInput('a', attempt + 1, user[1])]);
          expect(host.requests.length, label).toBe(before);
          attempt++;
          state = result.state;
          continue;
        }
      }
      const result = hostResult(random);
      results.push(result);
      queue.push(result);
      const before = host.requests.length;
      const expected = modelTurn(model, config, result);
      const outcome = (op === 0
        ? await startSession({ flow }, host.host)
        : await continueSession({ flow, state: JSON.parse(JSON.stringify(state)), input: { text: user![0] } }, host.host)) as SessionResult;
      const calls = host.requests.length - before;
      expect(calls, `${label} op ${op}: una llamada como mucho`).toBeLessThanOrEqual(1);
      if (calls === 0) queue.pop();
      expect(outcome.events.map((e) => (e.type === 'error' ? { type: 'error', code: e.code } : e)), `${label} op ${op}`).toEqual(
        expected.terminal.kind === 'fail' ? [...expected.events, { type: 'error', code: expected.terminal.code }] : expected.events,
      );
      state = outcome.state;
      attempt = 1;
      if (expected.terminal.kind === 'wait') {
        expect(outcome.status, label).toBe('waiting');
        const conversation = (outcome.state as { conversation?: { messages: unknown[]; costUsd: number; collected: Record<string, unknown> } }).conversation;
        expect(conversation?.costUsd, label).toBe(model.cost);
        expect(conversation?.collected, label).toEqual(model.email === null ? {} : { email: model.email });
        continue;
      }
      expect(outcome.status, label).toBe(expected.terminal.kind === 'end' ? 'ended' : 'failed');
      expect((outcome.state as { conversation?: unknown }).conversation, label).toBeUndefined();
      if (expected.terminal.kind === 'end') {
        expect((outcome.state as unknown as { contact: { email: string | null } }).contact.email, label).toBe(model.stored);
      }
      return;
    }
    // Doce operaciones sin terminar: solo es posible si maxTurns lo permitiera, y el modelo lo confirma.
    expect(model.turns, label).toBeLessThan(config.maxTurns);
  })();
}

describe('Modelo de referencia del nodo llm (turnos, coste, eventos y estado)', () => {
  it('2000 conversaciones al azar coinciden con el modelo', async () => {
    for (let seed = 1; seed <= 2000; seed++) await runConversation(seed);
  });
});
