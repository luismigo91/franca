import type { LlmNode } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { Conversation } from '../../src/llm/conversation.js';
import { buildTurnRequest } from '../../src/llm/request.js';
import type { SlotSpec } from '../../src/llm/slots.js';

const SPECS: SlotSpec[] = [
  { name: 'email', type: 'email', description: 'Email de contacto', required: true },
  { name: 'motivo', type: 'string', description: 'Motivo', required: false },
];

const node = (extra: Partial<LlmNode> = {}): LlmNode =>
  ({ id: 'a', type: 'llm', provider: 'principal', goal: 'Consigue el email.', next: 'ok', onExhausted: 'ko', ...extra }) as LlmNode;

const build = (n: LlmNode, conversation = Conversation.empty(), overrides: { system?: string | null; locale?: string } = {}) =>
  buildTurnRequest(n, { locale: overrides.locale ?? 'es', conversation, specs: SPECS, system: overrides.system ?? null, goal: 'Consigue el email.' });

describe('buildTurnRequest', () => {
  it('el primer turno con un nodo mínimo', () => {
    expect(build(node())).toEqual({
      nodeId: 'a',
      provider: 'principal',
      model: null,
      system: null,
      goal: 'Consigue el email.',
      slots: [
        { name: 'email', type: 'email', description: 'Email de contacto', required: true, collected: false },
        { name: 'motivo', type: 'string', description: 'Motivo', required: false, collected: false },
      ],
      history: [],
      temperature: null,
      locale: 'es',
      turn: 1,
      maxTurns: 8,
    });
  });

  it('las claves salen en el orden del contrato', () => {
    expect(Object.keys(build(node()))).toEqual(['nodeId', 'provider', 'model', 'system', 'goal', 'slots', 'history', 'temperature', 'locale', 'turn', 'maxTurns']);
  });

  it('usa los valores del nodo: model, temperature, maxTurns y el system ya renderizado', () => {
    const request = build(node({ model: 'claude-x', temperature: 0.2, maxTurns: 10, system: 'plantilla {{x}}' }), Conversation.empty(), { system: 'Hablas con Ana.', locale: 'en-GB' });
    expect(request).toMatchObject({ model: 'claude-x', temperature: 0.2, maxTurns: 10, system: 'Hablas con Ana.', locale: 'en-GB' });
  });

  it('temperature 0 se conserva (no se confunde con ausente)', () => {
    expect(build(node({ temperature: 0 })).temperature).toBe(0);
  });

  it('turn es el número de llamadas hechas + 1, y collected refleja lo recogido', () => {
    const conversation = Conversation.empty();
    conversation.pushAssistant('¿Me das tu email?');
    conversation.addTurn(0.01);
    conversation.collect(new Map([['email', 'a@b.co']]));
    conversation.pushUser('Hola');
    const request = build(node(), conversation);
    expect(request.turn).toBe(2);
    expect(request.history).toEqual([
      { role: 'assistant', text: '¿Me das tu email?' },
      { role: 'user', text: 'Hola' },
    ]);
    expect(request.slots.map((s) => [s.name, s.collected])).toEqual([
      ['email', true],
      ['motivo', false],
    ]);
  });

  it('un objeto nuevo por turno, con history y slots nuevos: lo que haga el host no altera la conversación', () => {
    const conversation = Conversation.empty();
    conversation.pushAssistant('uno');
    conversation.addTurn(0);
    conversation.pushUser('dos');
    const first = build(node(), conversation);
    const second = build(node(), conversation);
    expect(second).not.toBe(first);
    expect(second.history).not.toBe(first.history);
    expect(second.slots).not.toBe(first.slots);
    expect(second.history[0]).not.toBe(first.history[0]);
    first.history.length = 0;
    first.goal = 'otro';
    first.slots[0]!.collected = true;
    first.history.push({ role: 'user', text: 'inventado' });
    const third = build(node(), conversation);
    expect(third.history).toEqual([
      { role: 'assistant', text: 'uno' },
      { role: 'user', text: 'dos' },
    ]);
    expect(third.slots[0]!.collected).toBe(false);
    expect(third.goal).toBe('Consigue el email.');
    expect(conversation.history()).toHaveLength(2);
  });

  it('un nodo sin slots da slots vacíos', () => {
    const request = buildTurnRequest(node(), { locale: 'es', conversation: Conversation.empty(), specs: [], system: null, goal: 'g' });
    expect(request.slots).toEqual([]);
  });
});
