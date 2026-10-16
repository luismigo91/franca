import type { LlmNode } from '@franca/spec';
import { MAX_EXTERNAL_CALLS_PER_ADVANCE, type LlmExitReason } from '../constants.js';
import { checkTextAnswer } from '../input/answer.js';
import { invokeLlm, readLlmCapability } from '../llm/capability.js';
import { Conversation, exhaustedReason } from '../llm/conversation.js';
import { buildTurnRequest } from '../llm/request.js';
import { readTurnResult } from '../llm/result.js';
import { collectSlots, hasRequired, revalidateCollected, slotSpecs, type SlotSpec } from '../llm/slots.js';
import { readAssistantText } from '../llm/text.js';
import { renderTemplate, ValueTooLargeError } from '../template.js';
import type { EngineTextInputEvent, LlmConversation } from '../types.js';
import { VALUE_TOO_LARGE } from './message.js';
import type { NodeExecutor, StepContext, StepOutcome } from './types.js';
import { executeUnsupported } from './unsupported.js';

const fail = (code: 'llm_not_configured' | 'llm_host_error' | 'llm_limit_exceeded', message: string): StepOutcome => ({ kind: 'fail', code, message });

// Mensajes fijos: nunca incluyen textos, `system`, `goal`, slots ni nada de lo que lance o devuelva el host.
const HOST_ERROR = fail('llm_host_error', 'la capacidad llm del host falló o devolvió un resultado fuera de contrato');
const NOT_CONFIGURED = fail('llm_not_configured', 'el proveedor o el modelo del nodo no están configurados en la instalación');
const LIMIT_EXCEEDED = fail('llm_limit_exceeded', `se superó el límite de ${MAX_EXTERNAL_CALLS_PER_ADVANCE} llamadas externas por avance`);

/** El mensaje del usuario se comprueba como el de un `input` de texto sin reglas. */
const NO_RULES = { program: null } as const;

/** Lo que la continuación sabe de la conversación en espera. */
export interface PendingMessage {
  /** Intento de la pregunta pendiente (el que se está respondiendo). */
  attempt: number;
  /** Conversación del estado, ya comprobada con `parseConversation`. */
  conversation: LlmConversation;
  /** El `text` de la entrada, sin recortar. */
  text: string;
}

/** Idioma del flujo: parte de `locale` antes del guion, como en `input`. */
const languageOf = (ctx: StepContext): string => ctx.locale.split('-')[0]!;

const inputEvent = (nodeId: string, attempt: number, reason: EngineTextInputEvent['reason']): EngineTextInputEvent => ({
  type: 'input',
  nodeId,
  inputType: 'text',
  attempt,
  reason,
});

/**
 * Llegada a un nodo `llm` desde otro nodo: conversación nueva y primer turno.
 *
 * El orden de las comprobaciones es el de la spec: límite de pasos (lo hace `run`), capacidad del
 * host, agotamiento, tamaño de `system` y `goal` y límite de llamadas. Un nodo hace como mucho un
 * turno por operación, así que la capacidad se lee una sola vez.
 */
export const executeLlm: NodeExecutor<'llm'> = (node, ctx) => {
  const capability = readLlmCapability(ctx.host);
  if (capability.kind === 'absent') return executeUnsupported(node);
  if (capability.kind === 'error') return HOST_ERROR;
  return converse(node, ctx, capability.call, Conversation.empty(), slotSpecs(node, ctx.variableTypes));
};

/**
 * Primer paso de una continuación en un `llm`: comprueba el mensaje del usuario y hace el turno.
 * La capacidad del host se comprueba antes que el mensaje.
 *
 * @param node Nodo `llm` donde espera la sesión (forma JSON).
 * @param ctx Contexto de la operación.
 * @param pending Intento, conversación guardada y texto del usuario.
 * @returns Un mensaje inválido deja la espera con el intento aumentado, sin llamar al host; uno válido hace el turno.
 */
export function resumeLlm(node: LlmNode, ctx: StepContext, pending: PendingMessage): StepOutcome | Promise<StepOutcome> {
  const capability = readLlmCapability(ctx.host);
  if (capability.kind === 'absent') return executeUnsupported(node);
  if (capability.kind === 'error') return HOST_ERROR;
  const language = languageOf(ctx);
  const check = checkTextAnswer(pending.text, 'text', language, NO_RULES);
  if (!check.ok) {
    // La conversación queda tal cual llegó: ni se revalida ni se cuenta nada.
    ctx.emit(inputEvent(node.id, pending.attempt + 1, check.reason));
    const unchanged = Conversation.restore(pending.conversation, new Map(Object.entries(pending.conversation.collected)));
    return { kind: 'wait', attempt: pending.attempt + 1, conversation: unchanged };
  }
  const specs = slotSpecs(node, ctx.variableTypes);
  const conversation = Conversation.restore(pending.conversation, revalidateCollected(pending.conversation.collected, specs, language));
  conversation.pushUser(check.value as string);
  return converse(node, ctx, capability.call, conversation, specs);
}

/** Sale del nodo: guarda los slots recogidos, emite el evento `llm` y descarta la conversación. */
function exit(node: LlmNode, ctx: StepContext, conversation: Conversation, target: string, reason: LlmExitReason | null): StepOutcome {
  for (const [name, value] of conversation.collected) ctx.vars.set(name, value);
  ctx.emit({ type: 'llm', nodeId: node.id, turns: conversation.turns, costUsd: conversation.costUsd, reason });
  return { kind: 'next', nodeId: target };
}

/** Espera la respuesta del usuario en la misma conversación. */
function waitForUser(node: LlmNode, ctx: StepContext, conversation: Conversation): StepOutcome {
  ctx.emit(inputEvent(node.id, 1, null));
  return { kind: 'wait', attempt: 1, conversation };
}

/** Renderiza `system` y `goal`; `null` si alguno supera el tamaño máximo. */
function renderPrompt(node: LlmNode, ctx: StepContext): { system: string | null; goal: string } | null {
  const lookup = (name: string) => ctx.vars.get(name);
  try {
    const system = node.system === undefined ? null : renderTemplate(node.system, lookup);
    return { system, goal: renderTemplate(node.goal, lookup) };
  } catch (error) {
    if (error instanceof ValueTooLargeError) return null;
    throw error;
  }
}

/**
 * Un turno de la conversación, en el orden de la spec: agotamiento (sin llamar al host), tamaño de
 * `system` y `goal`, límite de llamadas, llamada y lectura del resultado, y por último qué hace el
 * nodo con él.
 */
async function converse(
  node: LlmNode,
  ctx: StepContext,
  call: Function,
  conversation: Conversation,
  specs: readonly SlotSpec[],
): Promise<StepOutcome> {
  const exhausted = exhaustedReason(conversation, node);
  if (exhausted !== null) return exit(node, ctx, conversation, node.onExhausted, exhausted);
  const prompt = renderPrompt(node, ctx);
  if (prompt === null) return VALUE_TOO_LARGE;
  if (!ctx.reserveExternalCall()) return LIMIT_EXCEEDED;

  const request = buildTurnRequest(node, { locale: ctx.locale, conversation, specs, ...prompt });
  const called = await invokeLlm(call, ctx.host, request);
  if (!called.ok) return HOST_ERROR;
  const result = readTurnResult(called.value, specs);
  if (result === null) return HOST_ERROR;
  if (result.kind === 'not_configured') return NOT_CONFIGURED;

  // Cada llamada es un turno, termine como termine; una suma no finita está fuera de contrato y no cuenta.
  if (!conversation.addTurn(result.costUsd)) return HOST_ERROR;
  if (result.kind === 'refusal') return exit(node, ctx, conversation, node.onExhausted, 'refusal');
  if (result.kind === 'failed') return exit(node, ctx, conversation, node.onExhausted, 'provider_error');

  // El texto se comprueba antes de recoger nada: un turno descartado no aporta slots ni `done`.
  const text = readAssistantText(result.text);
  if (text === null) return exit(node, ctx, conversation, node.onExhausted, 'invalid_turn');
  conversation.collect(collectSlots(result.values, specs, languageOf(ctx)));
  ctx.emit({ type: 'message', nodeId: node.id, content: [{ kind: 'text', text }], typingDelayMs: ctx.typingDelayMs });
  conversation.pushAssistant(text);

  if (result.done && hasRequired(specs, conversation.collected)) {
    if (node.next !== node.id) return exit(node, ctx, conversation, node.next, null);
    // Autosalto: no se devuelve `next(node.id)` (sería una llegada nueva, con conversación vacía).
    for (const [name, value] of conversation.collected) ctx.vars.set(name, value);
    const spent = exhaustedReason(conversation, node);
    if (spent !== null) return exit(node, ctx, conversation, node.onExhausted, spent);
    ctx.emit({ type: 'llm', nodeId: node.id, turns: conversation.turns, costUsd: conversation.costUsd, reason: null });
    return waitForUser(node, ctx, conversation);
  }
  const spent = exhaustedReason(conversation, node);
  if (spent !== null) return exit(node, ctx, conversation, node.onExhausted, spent);
  return waitForUser(node, ctx, conversation);
}
