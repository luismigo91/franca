import { describe, expect, it } from 'vitest';
import { continueSession, startSession, type AdvanceResult, type SessionResult, type SessionState } from '../src/index.js';
import { choicesOf, condition, end, flowOf, input, message, rule, variable, type Obj } from './helpers/flows.js';

/** Conversaciones generadas al azar (semilla fija) con respuestas hostiles: se comprueban invariantes, no valores. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1103515245) + 12345) >>> 0;
    return a / 4294967296;
  };
}

const TYPES = ['text', 'email', 'phone', 'number', 'url', 'date', 'boolean', 'choice', 'choice-multiple'] as const;
const ANSWERS = [
  '', ' ', 'Ana', 'ana@example.com', 'ANA@Example.COM', '+34 600 123 456', '12345', '1,5', '1.500', '-0', '1e3', 'example.com', 'http://a.b/c', '127.0.0.1', '2026-02-29', '2024-02-29',
  'sí', 'yes', 'true', 'no', 'a\u0000b', 'x\ud800', '\u{1F600}', 'z'.repeat(4097), 'z'.repeat(4096), '{{secreto}}', '<b>x</b>', '0', '99999999999999999999', ' padded ',
];

function inputFor(rand: () => number, id: string, variableName: string, next: string): Obj {
  const type = TYPES[Math.floor(rand() * TYPES.length)]!;
  const validation: Obj = {};
  if (rand() < 0.4) validation.maxRetries = Math.floor(rand() * 4);
  if (rand() < 0.3 && type !== 'choice') validation.pattern = ['^\\d+$', '@', '^[a-z]+$', '^.{3,}$'][Math.floor(rand() * 4)];
  if (rand() < 0.3) validation.min = Math.floor(rand() * 3);
  if (rand() < 0.2) validation.max = 1 + Math.floor(rand() * 20);
  if (rand() < 0.3) validation.retryMessage = 'Otra vez, {{secreto}}';
  if (type === 'choice') return input(id, variableName, 'choice', undefined, { choices: choicesOf(['a', 'b', 'c'], next) });
  if (type === 'choice-multiple') return input(id, variableName, 'choice', next, { multiple: true, choices: choicesOf(['a', 'b', 'c']), validation });
  return input(id, variableName, type, next, { validation, ...(rand() < 0.3 ? { placeholder: 'ej. {{secreto}}' } : {}) });
}

function flowFor(rand: () => number): Obj {
  const count = 1 + Math.floor(rand() * 3);
  const nodes: Obj[] = [message('m', 'Hola {{secreto}}', 'i0')];
  for (let i = 0; i < count; i++) {
    const next = i + 1 < count ? `i${i + 1}` : 'c';
    nodes.push(inputFor(rand, `i${i}`, `v${i}`, next));
  }
  nodes.push(condition('c', [[rule('v0', 'isSet'), 'fin']], 'm'), end('fin', { outcome: 'listo', text: 'Fin {{v0}}' }));
  return flowOf(nodes, {
    variables: [variable('secreto', { default: 'S3CR3TO' }), ...Array.from({ length: count }, (_, i) => variable(`v${i}`, { type: 'json', pii: true }))],
    extra: rand() < 0.5 ? { locale: ['es', 'en', 'fr', 'en-GB'][Math.floor(rand() * 4)] } : {},
  });
}

function answerFor(rand: () => number, state: SessionState, flow: Obj): unknown {
  const node = (flow.nodes as Obj[]).find((n) => n.id === state.nodeId)!;
  if (rand() < 0.08) return [null, 'x', {}, { text: 5 }, { text: 'a', b: 1 }, { choice: 'zz' }, { choices: ['a', 'a'] }, undefined][Math.floor(rand() * 8)];
  if (node.inputType !== 'choice') return { text: ANSWERS[Math.floor(rand() * ANSWERS.length)] };
  const ids = ['a', 'b', 'c'];
  if (node.multiple) return { choices: ids.filter(() => rand() < 0.5) };
  return { choice: rand() < 0.1 ? 'zz' : ids[Math.floor(rand() * 3)] };
}

describe('propiedades sobre conversaciones generadas con respuestas hostiles', () => {
  it('invariantes de eventos, estado, privacidad y determinismo en 400 conversaciones', async () => {
    const rand = prng(20261018);
    let turns = 0;
    const seenReasons = new Set<string>();
    const seenStatuses = new Set<string>();
    for (let c = 0; c < 400; c++) {
      const flow = flowFor(rand);
      const results: AdvanceResult[] = [];
      let current: AdvanceResult = await startSession({ flow });
      results.push(current);
      for (let t = 0; t < 8 && current.ok && current.status === 'waiting'; t++) {
        const state: SessionState = current.state;
        const answer = answerFor(rand, state, flow);
        const before = JSON.stringify(state);
        const next = await continueSession({ flow, state, input: answer });
        const again = await continueSession({ flow, state: JSON.parse(before), input: answer });
        expect(JSON.stringify(next), 'determinismo').toBe(JSON.stringify(again));
        expect(JSON.stringify(state), 'el estado recibido no cambia').toBe(before);
        results.push(next);
        turns++;
        if (!next.ok) {
          expect(next.code).toBe('invalid_input');
          expect(Object.keys(next).sort()).toEqual(['code', 'message', 'ok']);
          continue; // el host reintenta con el mismo estado
        }
        const last = next.events.at(-1)!;
        expect(['input', 'end', 'error']).toContain(last.type);
        expect(next.events.filter((e) => e.type === 'input' || e.type === 'end' || e.type === 'error')).toHaveLength(1);
        expect(last.type).toBe(next.status === 'waiting' ? 'input' : next.status === 'ended' ? 'end' : 'error');
        expect(JSON.parse(JSON.stringify(next.state))).toEqual(next.state);
        seenStatuses.add(next.status);
        if (next.status === 'waiting') {
          expect(last).toMatchObject({ type: 'input', nodeId: next.state.nodeId, attempt: next.state.attempt });
          expect(next.state.outcome).toBeNull();
          expect(next.state.error).toBeNull();
          if (last.type === 'input' && last.reason) seenReasons.add(last.reason);
          if (next.state.nodeId === state.nodeId) expect(next.state.attempt).toBe(state.attempt! + 1);
          else expect(next.state.attempt).toBe(1);
        } else {
          expect(next.state).not.toHaveProperty('attempt');
        }
        current = next;
      }
      // privacidad: el marcador de una respuesta inválida o rechazada solo puede estar en una variable (estado), nunca en eventos ni errores
      for (const r of results) {
        if (r.ok) {
          const text = JSON.stringify(r.events);
          expect(text).not.toContain('a\\u0000b');
          expect(text).not.toContain('z'.repeat(100));
          expect(JSON.stringify(r.state.error)).not.toMatch(/ana@|600|z{50}/);
        } else {
          expect(JSON.stringify(r)).not.toMatch(/ana@|600|zz|secreto/i);
        }
      }
    }
    expect(turns).toBeGreaterThan(800);
    expect([...seenReasons].sort()).toEqual(['invalid_format', 'out_of_range', 'pattern_mismatch', 'required', 'too_long']);
    expect([...seenStatuses].sort()).toEqual(['ended', 'failed', 'waiting']);
  });

  it('una respuesta válida solo cambia la variable del input: el resto de variables queda igual', async () => {
    const rand = prng(7);
    for (let c = 0; c < 150; c++) {
      const flow = flowFor(rand);
      let current = (await startSession({ flow })) as SessionResult;
      for (let t = 0; t < 6 && current.status === 'waiting'; t++) {
        const state = current.state;
        const node = (flow.nodes as Obj[]).find((n) => n.id === state.nodeId)!;
        const next = await continueSession({ flow, state, input: answerFor(rand, state, flow) });
        if (!next.ok) continue;
        // Cada operación recibe una sola respuesta y se detiene en el siguiente input: solo puede cambiar la variable del input respondido.
        const { [node.variable as string]: _answered, ...others } = next.state.variables;
        const { [node.variable as string]: _before, ...othersBefore } = state.variables;
        expect(others).toEqual(othersBefore);
        current = next;
      }
    }
  });
});
