import type { LlmNode } from '@franca/spec';
import { DEFAULT_LLM_MAX_TURNS, MAX_CONVERSATION_MESSAGES, MAX_INPUT_LENGTH, type LlmExitReason } from '../constants.js';
import { hasUnstorable } from '../input/parsers/chars.js';
import type { LlmConversation, LlmMessage, VariableValue } from '../types.js';

/** Los `maxTurns` efectivos de un nodo `llm`. */
export const maxTurnsOf = (node: Pick<LlmNode, 'maxTurns'>): number => node.maxTurns ?? DEFAULT_LLM_MAX_TURNS;

/**
 * La conversación de un nodo `llm` dentro de una operación: mensajes, turnos, coste y slots
 * recogidos. Es propia de la operación; el estado en espera se obtiene con `toState`.
 */
export class Conversation {
  /** Mensajes en orden. En una espera alternan y empiezan y terminan en el asistente. */
  private readonly list: LlmMessage[];
  /** Llamadas hechas al proveedor. */
  private count: number;
  private cost: number;
  private readonly values: Map<string, VariableValue>;

  private constructor(messages: LlmMessage[], turns: number, costUsd: number, collected: Map<string, VariableValue>) {
    this.list = messages;
    this.count = turns;
    this.cost = costUsd;
    this.values = collected;
  }

  /** Conversación nueva: sin mensajes, sin turnos, coste 0 y sin slots recogidos. */
  static empty(): Conversation {
    return new Conversation([], 0, 0, new Map());
  }

  /**
   * Reconstruye la conversación de un estado en espera. Los turnos salen de los mensajes: en una
   * espera cada turno ha dejado exactamente un texto del asistente.
   *
   * @param state Conversación ya comprobada con `parseConversation`.
   * @param collected Recogidos ya revalidados contra el nodo actual.
   */
  static restore(state: LlmConversation, collected: Map<string, VariableValue>): Conversation {
    return new Conversation(state.messages.map((m) => ({ role: m.role, text: m.text })), (state.messages.length + 1) / 2, state.costUsd, collected);
  }

  get turns(): number {
    return this.count;
  }

  get costUsd(): number {
    return this.cost;
  }

  get collected(): ReadonlyMap<string, VariableValue> {
    return this.values;
  }

  /** @returns Una copia de los mensajes: lo que haga el host con ella no altera la conversación. */
  history(): LlmMessage[] {
    return this.list.map((m) => ({ role: m.role, text: m.text }));
  }

  pushUser(text: string): void {
    this.list.push({ role: 'user', text });
  }

  pushAssistant(text: string): void {
    this.list.push({ role: 'assistant', text });
  }

  /**
   * Cuenta un turno y suma su coste.
   *
   * @returns `false` (sin contar nada) si la suma no es finita: el resultado está fuera de contrato.
   */
  addTurn(costUsd: number): boolean {
    const total = this.cost + costUsd;
    if (!Number.isFinite(total)) return false;
    this.cost = total;
    this.count++;
    return true;
  }

  /** Suma los valores recogidos de un turno: el último válido de cada slot gana. */
  collect(values: ReadonlyMap<string, VariableValue>): void {
    for (const [name, value] of values) this.values.set(name, value);
  }

  /** @returns La conversación como valor JSON del estado (copia independiente, `collected` con propiedades propias). */
  toState(): LlmConversation {
    return {
      messages: this.history(),
      costUsd: this.cost,
      collected: Object.fromEntries(this.values),
    };
  }
}

/**
 * Por qué una conversación ya no puede seguir: sus turnos llegaron a `maxTurns` (gana si coinciden
 * con el coste) o su coste alcanzó `costCapUsd`.
 *
 * @returns El motivo, o `null` si puede seguir.
 */
export function exhaustedReason(conversation: Pick<Conversation, 'turns' | 'costUsd'>, node: Pick<LlmNode, 'maxTurns' | 'costCapUsd'>): LlmExitReason | null {
  if (conversation.turns >= maxTurnsOf(node)) return 'max_turns';
  if (node.costCapUsd !== undefined && conversation.costUsd >= node.costCapUsd) return 'cost_cap';
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseMessages(value: unknown): LlmMessage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CONVERSATION_MESSAGES || value.length % 2 === 0) return null;
  const messages: LlmMessage[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return null;
    const role = index % 2 === 0 ? 'assistant' : 'user';
    const text = item.text;
    if (item.role !== role || typeof text !== 'string' || text === '' || text.length > MAX_INPUT_LENGTH || hasUnstorable(text)) return null;
    messages.push({ role, text });
  }
  return messages;
}

/**
 * Lee la conversación de un estado ya copiado como JSON. No la compara con el flujo: eso es de la
 * reanudación (recogidos revalidados, `maxTurns` rebajado).
 *
 * @param value Valor sin tipar.
 * @returns La conversación, o `null` si no cumple la forma (→ `invalid_state`).
 */
export function parseConversation(value: unknown): LlmConversation | null {
  if (!isRecord(value)) return null;
  const messages = parseMessages(value.messages);
  const costUsd = value.costUsd;
  const collected = value.collected;
  if (messages === null || typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0) return null;
  if (!isRecord(collected) || !Object.values(collected).every((v) => v !== null)) return null;
  return { messages, costUsd: costUsd === 0 ? 0 : costUsd, collected: collected as Record<string, VariableValue> };
}
