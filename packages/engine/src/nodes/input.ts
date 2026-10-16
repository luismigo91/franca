import type { InputNode } from '@franca/spec';
import type { InvalidAnswerReason } from '../constants.js';
import { checkChoices, checkTextAnswer } from '../input/answer.js';
import type { ParsedInput } from '../input/user-input.js';
import { prepareRules } from '../input/validation.js';
import { renderTemplate, ValueTooLargeError } from '../template.js';
import type { EngineChoice, EngineInputEvent, InputType } from '../types.js';
import { renderContent, VALUE_TOO_LARGE } from './message.js';
import type { NodeExecutor, StepContext, StepOutcome } from './types.js';

/** `validation.maxRetries` cuando el flujo no lo define: el `default` del esquema. */
const DEFAULT_MAX_RETRIES = 3;

/** Lo que la continuación sabe de la respuesta del usuario. */
export interface PendingAnswer {
  /** Intento de la pregunta pendiente (el que se está respondiendo). */
  attempt: number;
  input: ParsedInput;
  /** Idioma del flujo: parte de `locale` antes del guion; `es` si no hay. */
  language: string;
}

const fail = (code: 'invalid_validation' | 'retries_exhausted', message: string): StepOutcome => ({ kind: 'fail', code, message });

/**
 * Renderiza y emite `message` + `input`, y espera. Todo se renderiza antes de emitir, así que un
 * `value_too_large` no deja ningún evento de este nodo.
 */
function ask(
  node: InputNode,
  ctx: StepContext,
  attempt: number,
  reason: InvalidAnswerReason | null,
  retry: boolean,
): StepOutcome {
  const lookup = (name: string) => ctx.vars.get(name);
  try {
    const content =
      retry && node.validation?.retryMessage !== undefined
        ? [{ kind: 'text' as const, text: renderTemplate(node.validation.retryMessage, lookup) }]
        : renderContent(node.prompt, ctx);
    const event = buildInputEvent(node, ctx, attempt, reason);
    ctx.emit({ type: 'message', nodeId: node.id, content, typingDelayMs: ctx.typingDelayMs });
    ctx.emit(event);
    return { kind: 'wait', attempt };
  } catch (error) {
    if (error instanceof ValueTooLargeError) return VALUE_TOO_LARGE;
    throw error;
  }
}

function buildInputEvent(node: InputNode, ctx: StepContext, attempt: number, reason: InvalidAnswerReason | null): EngineInputEvent {
  const lookup = (name: string) => ctx.vars.get(name);
  const placeholder = node.placeholder === undefined ? {} : { placeholder: renderTemplate(node.placeholder, lookup) };
  // Orden de claves fijo (golden estables): type, nodeId, inputType, attempt, reason, placeholder?, multiple?, choices?
  if (node.inputType !== 'choice') {
    const inputType = node.inputType as Exclude<InputType, 'choice'>;
    return { type: 'input', nodeId: node.id, inputType, attempt, reason, ...placeholder };
  }
  const choices: EngineChoice[] = (node.choices ?? []).map((choice) => ({
    id: choice.id,
    label: renderTemplate(choice.label, lookup),
    ...(choice.imageUrl === undefined ? {} : { imageUrl: renderTemplate(choice.imageUrl, lookup) }),
  }));
  return { type: 'input', nodeId: node.id, inputType: 'choice', attempt, reason, ...placeholder, multiple: node.multiple === true, choices };
}

/** Llegada a un input: comprueba la validación, pregunta (intento 1) y espera. No toca variables. */
export const executeInput: NodeExecutor<'input'> = (node, ctx) => {
  const rules = prepareRules(node);
  if (!rules.ok) return fail('invalid_validation', rules.message);
  return ask(node, ctx, 1, null, false);
};

/**
 * Primer paso de una continuación: evalúa la respuesta del usuario.
 *
 * @param node Nodo input donde espera la sesión (forma JSON).
 * @param ctx Contexto de la operación.
 * @param pending Intento, entrada ya leída e idioma.
 * @returns El siguiente nodo si la respuesta es válida; si no, una nueva pregunta o el fallo por reintentos agotados.
 */
export function resumeInput(node: InputNode, ctx: StepContext, pending: PendingAnswer): StepOutcome {
  const rules = prepareRules(node);
  if (!rules.ok) return fail('invalid_validation', rules.message);
  const { input } = pending;

  if (input.kind === 'choice') {
    const choice = node.choices![input.option]!;
    ctx.vars.set(node.variable, choice.value ?? choice.id);
    return { kind: 'next', nodeId: choice.next! };
  }
  const check =
    input.kind === 'choices'
      ? checkChoices(node, input.options, rules.rules)
      : checkTextAnswer(input.text, node.inputType as Exclude<InputType, 'choice'>, pending.language, rules.rules);
  if (check.ok) {
    ctx.vars.set(node.variable, check.value);
    return { kind: 'next', nodeId: node.next! };
  }
  if (pending.attempt > (node.validation?.maxRetries ?? DEFAULT_MAX_RETRIES)) {
    return fail('retries_exhausted', 'se agotaron los reintentos de la respuesta');
  }
  return ask(node, ctx, pending.attempt + 1, check.reason, true);
}
