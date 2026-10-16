import type { Node } from '@franca/spec';
import { expectedKey, readTextInput, readUserInput, type ParsedInput } from './input/user-input.js';
import { resumeInput } from './nodes/input.js';
import { resumeLlm } from './nodes/llm.js';
import type { NodeOfType, StepContext, StepOutcome } from './nodes/types.js';
import type { LlmConversation, SessionState } from './types.js';

/** Tipos de nodo en los que una sesión puede esperar al usuario. */
export type WaitingNodeType = 'input' | 'llm';

/** La entrada del usuario ya leída, según el tipo de nodo en espera. */
interface ResumeInputs {
  input: ParsedInput;
  llm: string;
}

/** Lo que el estado en espera aporta a la reanudación. */
interface Waiting {
  /** Número de intento de la pregunta pendiente. */
  attempt: number;
  /** Solo en la espera de un `llm`. */
  conversation: LlmConversation | undefined;
  /** Idioma del flujo: parte de `locale` antes del guion; `es` si no hay. */
  language: string;
}

interface Resumer<K extends WaitingNodeType> {
  /** @returns La entrada leída, o `null` si no tiene la forma que pide el nodo (→ `invalid_input`). */
  readInput(node: NodeOfType<K>, input: unknown): ResumeInputs[K] | null;
  /** Texto del rechazo `invalid_input`. */
  shapeMessage(node: NodeOfType<K>): string;
  /** Primer paso de la operación: evalúa la entrada del usuario. */
  resume(node: NodeOfType<K>, ctx: StepContext, waiting: Waiting, input: ResumeInputs[K]): StepOutcome | Promise<StepOutcome>;
}

const INPUT_SHAPES = {
  text: 'la entrada debe ser {"text": string}',
  choice: 'la entrada debe ser {"choice": id} con el id de una opción del nodo',
  choices: 'la entrada debe ser {"choices": [id, …]} con ids de opciones del nodo, sin repetir',
} as const;

/**
 * Una reanudación por cada tipo de nodo en que se puede esperar. El tipo mapeado hace fallar
 * `tsc` si se añade un tipo de espera sin su resumidor.
 */
export const RESUMERS: { readonly [K in WaitingNodeType]: Resumer<K> } = {
  input: {
    readInput: readUserInput,
    shapeMessage: (node) => INPUT_SHAPES[expectedKey(node)],
    resume: (node, ctx, waiting, input) => resumeInput(node, ctx, { attempt: waiting.attempt, input, language: waiting.language }),
  },
  llm: {
    readInput: (_node, input) => readTextInput(input),
    shapeMessage: () => INPUT_SHAPES.text,
    resume: (node, ctx, waiting, text) => resumeLlm(node, ctx, { attempt: waiting.attempt, conversation: waiting.conversation!, text }),
  },
};

/**
 * En qué tipo de nodo espera un estado en espera: lo dice el estado, no el flujo. Una conversación
 * presente (`!== undefined`, nunca por veracidad) significa un `llm`; sin ella, un `input`.
 */
export const waitingTypeOf = (state: Pick<SessionState, 'conversation'>): WaitingNodeType => (state.conversation !== undefined ? 'llm' : 'input');

export type WaitingNode = NodeOfType<WaitingNodeType>;

export const isWaitingNode = (node: Node): node is WaitingNode => node.type in RESUMERS;

export type ResumePlan =
  | { kind: 'rejected'; message: string }
  | { kind: 'ready'; step: (ctx: StepContext) => StepOutcome | Promise<StepOutcome> };

function planFor<K extends WaitingNodeType>(resumer: Resumer<K>, node: NodeOfType<K>, waiting: Waiting, raw: unknown): ResumePlan {
  const input = resumer.readInput(node, raw);
  if (input === null) return { kind: 'rejected', message: resumer.shapeMessage(node) };
  return { kind: 'ready', step: (ctx) => resumer.resume(node, ctx, waiting, input) };
}

/**
 * Lee la entrada del usuario con la forma que pide el nodo en que espera la sesión y prepara el
 * primer paso de la operación.
 *
 * @param node Nodo en el que espera la sesión (forma JSON).
 * @param state Estado en espera, ya comprobado.
 * @param raw Entrada sin tipar.
 * @param language Idioma del flujo.
 */
export function planResume(node: WaitingNode, state: SessionState, raw: unknown, language: string): ResumePlan {
  const waiting: Waiting = { attempt: state.attempt!, conversation: state.conversation, language };
  switch (node.type) {
    case 'input':
      return planFor(RESUMERS.input, node, waiting, raw);
    case 'llm':
      return planFor(RESUMERS.llm, node, waiting, raw);
    default:
      return node satisfies never;
  }
}
