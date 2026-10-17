import type { EngineEvent, InputType, RenderedContentItem } from '@franca/engine';

/**
 * Los `type` de evento, los `kind` de contenido y los `inputType` que el chat sabe pintar (D10). Lo que no está aquí
 * se ignora o va a «Pregunta no soportada». El tipo `_Missing` de cada lista obliga a que, si el motor o la spec
 * añaden un valor, `pnpm typecheck` falle hasta que la web lo pinte o lo excluya a propósito.
 */
export const KNOWN_EVENT_TYPES = ['message', 'input', 'http', 'llm', 'end', 'error'] as const satisfies readonly EngineEvent['type'][];
export const KNOWN_CONTENT_KINDS = ['text', 'image', 'video', 'audio', 'embed'] as const satisfies readonly RenderedContentItem['kind'][];
export const KNOWN_INPUT_TYPES = [
  'text',
  'email',
  'phone',
  'number',
  'url',
  'date',
  'boolean',
  'choice',
] as const satisfies readonly InputType[];

type MissingEventType = Exclude<EngineEvent['type'], (typeof KNOWN_EVENT_TYPES)[number]>;
type MissingContentKind = Exclude<RenderedContentItem['kind'], (typeof KNOWN_CONTENT_KINDS)[number]>;
type MissingInputType = Exclude<InputType, (typeof KNOWN_INPUT_TYPES)[number]>;

/** Falla en tiempo de compilación si alguna lista deja un valor del motor sin cubrir. */
export const KNOWN_TYPES_ARE_EXHAUSTIVE: [MissingEventType, MissingContentKind, MissingInputType] extends [never, never, never] ? true : false = true;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];
export type KnownContentKind = (typeof KNOWN_CONTENT_KINDS)[number];
export type KnownInputType = (typeof KNOWN_INPUT_TYPES)[number];
