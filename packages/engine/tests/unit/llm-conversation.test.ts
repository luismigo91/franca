import { describe, expect, it } from 'vitest';
import { Conversation, exhaustedReason, maxTurnsOf } from '../../src/llm/conversation.js';

describe('maxTurnsOf', () => {
  it('es el del nodo o 8', () => {
    expect(maxTurnsOf({})).toBe(8);
    expect(maxTurnsOf({ maxTurns: 3 })).toBe(3);
  });
});

describe('exhaustedReason', () => {
  const at = (turns: number, costUsd: number) => ({ turns, costUsd });

  it('sin agotar → null', () => {
    expect(exhaustedReason(at(2, 0.04), { maxTurns: 3, costCapUsd: 0.05 })).toBeNull();
    expect(exhaustedReason(at(0, 0), {})).toBeNull();
  });

  it('turns ≥ maxTurns → max_turns (con ≥, no >)', () => {
    expect(exhaustedReason(at(3, 0), { maxTurns: 3 })).toBe('max_turns');
    expect(exhaustedReason(at(4, 0), { maxTurns: 3 })).toBe('max_turns');
    expect(exhaustedReason(at(2, 0), { maxTurns: 3 })).toBeNull();
    expect(exhaustedReason(at(8, 0), {})).toBe('max_turns');
    expect(exhaustedReason(at(7, 0), {})).toBeNull();
  });

  it('coste ≥ costCapUsd → cost_cap (con ≥, no >)', () => {
    expect(exhaustedReason(at(1, 0.05), { costCapUsd: 0.05 })).toBe('cost_cap');
    expect(exhaustedReason(at(1, 0.06), { costCapUsd: 0.05 })).toBe('cost_cap');
    expect(exhaustedReason(at(1, 0.0499), { costCapUsd: 0.05 })).toBeNull();
  });

  it('sin costCapUsd el coste no limita', () => {
    expect(exhaustedReason(at(1, 1000), {})).toBeNull();
  });

  it('si coinciden gana max_turns', () => {
    expect(exhaustedReason(at(1, 0.02), { maxTurns: 1, costCapUsd: 0.01 })).toBe('max_turns');
  });
});

describe('Conversation', () => {
  it('empieza vacía', () => {
    const c = Conversation.empty();
    expect([c.turns, c.costUsd, c.collected.size, c.history()]).toEqual([0, 0, 0, []]);
  });

  it('suma turnos y coste (0.03 + 0.02 = 0.05 exacto con la suma de JS)', () => {
    const c = Conversation.empty();
    expect(c.addTurn(0.03)).toBe(true);
    expect(c.addTurn(0.02)).toBe(true);
    expect(c.costUsd).toBe(0.05);
    expect(c.turns).toBe(2);
  });

  it('un coste que haría la suma no finita no se cuenta', () => {
    const c = Conversation.empty();
    c.addTurn(1e308);
    expect(c.addTurn(1e308)).toBe(false);
    expect(c.turns).toBe(1);
    expect(c.costUsd).toBe(1e308);
  });

  it('el último valor recogido gana y uno no mencionado se conserva', () => {
    const c = Conversation.empty();
    c.collect(new Map([['a', '1'], ['b', '2']]));
    c.collect(new Map([['a', '3']]));
    expect(Object.fromEntries(c.collected)).toEqual({ a: '3', b: '2' });
  });

  it('toState es una copia JSON y restore la reconstruye con los turnos de los mensajes', () => {
    const c = Conversation.empty();
    c.pushAssistant('uno');
    c.addTurn(0.01);
    c.pushUser('dos');
    c.pushAssistant('tres');
    c.addTurn(0.02);
    c.collect(new Map([['__proto__', 'p']]));
    const state = c.toState();
    expect(Object.hasOwn(state.collected, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    const restored = Conversation.restore(state, new Map(Object.entries(state.collected)));
    expect(restored.turns).toBe(2);
    expect(restored.costUsd).toBeCloseTo(0.03, 12);
    expect(restored.history()).toEqual(state.messages);
    state.messages[0]!.text = 'cambiado';
    expect(restored.history()[0]!.text).toBe('uno');
  });
});
