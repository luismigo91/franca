import type { LlmNode } from '@franca/spec';
import type { LlmTurnRequest } from '../types.js';
import { maxTurnsOf, type Conversation } from './conversation.js';
import type { SlotSpec } from './slots.js';

/**
 * Construye la petición de un turno: un objeto nuevo con `history` y `slots` nuevos (copias de la
 * conversación), así que lo que el host haga con ellos no altera el motor.
 *
 * @param node Nodo `llm` (forma JSON).
 * @param input `locale` del flujo, conversación, slots, y `system` y `goal` ya renderizados.
 */
export function buildTurnRequest(
  node: LlmNode,
  input: { locale: string; conversation: Conversation; specs: readonly SlotSpec[]; system: string | null; goal: string },
): LlmTurnRequest {
  const { conversation } = input;
  return {
    nodeId: node.id,
    provider: node.provider,
    model: node.model ?? null,
    system: input.system,
    goal: input.goal,
    slots: input.specs.map((spec) => ({
      name: spec.name,
      type: spec.type,
      description: spec.description,
      required: spec.required,
      collected: conversation.collected.has(spec.name),
    })),
    history: conversation.history(),
    temperature: node.temperature ?? null,
    locale: input.locale,
    turn: conversation.turns + 1,
    maxTurns: maxTurnsOf(node),
  };
}
