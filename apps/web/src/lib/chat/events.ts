import type { InputType } from '@franca/engine';
import { KNOWN_CONTENT_KINDS, KNOWN_EVENT_TYPES, KNOWN_INPUT_TYPES, type KnownContentKind } from '@/lib/chat/known-types';

/** Elemento de un mensaje del flujo, ya con la forma que sabe pintar el chat. */
export type ContentItem = { kind: 'text'; text: string } | { kind: Exclude<KnownContentKind, 'text'>; url: string; alt?: string };

export interface MessageEvent {
  type: 'message';
  nodeId: string;
  content: ContentItem[];
  typingDelayMs: number;
}

/** `http` y `llm` solo van al panel de detalles. */
export interface HttpActivityEvent {
  type: 'http';
  nodeId: string;
  attempts: number;
  status: number | null;
  error: string | null;
}

export interface LlmActivityEvent {
  type: 'llm';
  nodeId: string;
  turns: number;
  costUsd: number;
  reason: string | null;
}

/** Un `error` sin su `message`: el chat nunca lo lee, aunque la API lo mandara. */
export interface ErrorActivityEvent {
  type: 'error';
  nodeId: string;
  code: string;
}

export interface EndEvent {
  type: 'end';
  nodeId: string;
  outcome: string | null;
}

export interface ChoiceOption {
  id: string;
  label: string;
  imageUrl?: unknown;
}

/** Pregunta que espera el usuario. `unsupported` es un `inputType` que el chat no conoce. */
export type PendingQuestion = {
  nodeId: string;
  attempt: number;
  reason: string | null;
  placeholder?: string;
} & (
  | { kind: 'text'; inputType: Exclude<InputType, 'choice'> }
  | { kind: 'choice'; multiple: boolean; choices: ChoiceOption[] }
  | { kind: 'unsupported'; inputType: string }
);

export type InputEvent = { type: 'input' } & PendingQuestion;

export type ChatEvent = MessageEvent | InputEvent | HttpActivityEvent | LlmActivityEvent | ErrorActivityEvent | EndEvent;

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKnownContentKind(value: unknown): value is KnownContentKind {
  return typeof value === 'string' && (KNOWN_CONTENT_KINDS as readonly string[]).includes(value);
}

function isKnownInputType(value: unknown): value is InputType {
  return typeof value === 'string' && (KNOWN_INPUT_TYPES as readonly string[]).includes(value);
}

/** Lee el contenido de un mensaje: ignora los `kind` desconocidos y las formas rotas, sin lanzar. */
export function readContent(value: unknown): ContentItem[] {
  if (!Array.isArray(value)) return [];
  const items: ContentItem[] = [];
  for (const raw of value as unknown[]) {
    if (!isObject(raw) || !isKnownContentKind(raw.kind)) continue;
    if (raw.kind === 'text') {
      if (typeof raw.text === 'string') items.push({ kind: 'text', text: raw.text });
      continue;
    }
    const item: ContentItem = { kind: raw.kind, url: typeof raw.url === 'string' ? raw.url : '' };
    if (typeof raw.alt === 'string') item.alt = raw.alt;
    items.push(item);
  }
  return items;
}

function readOptions(value: unknown): ChoiceOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: ChoiceOption[] = [];
  for (const raw of value as unknown[]) {
    if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.label !== 'string') return null;
    options.push(raw.imageUrl === undefined ? { id: raw.id, label: raw.label } : { id: raw.id, label: raw.label, imageUrl: raw.imageUrl });
  }
  return options;
}

/**
 * Lee una pregunta (`input` de un evento o `pendingInput` del recurso). Un `inputType` desconocido, o un `choice` sin
 * opciones legibles, es `unsupported`. `null` si ni siquiera es un `input`.
 */
export function readPendingQuestion(value: unknown): PendingQuestion | null {
  if (!isObject(value) || value.type !== 'input' || typeof value.nodeId !== 'string') return null;
  const base = {
    nodeId: value.nodeId,
    attempt: typeof value.attempt === 'number' && Number.isFinite(value.attempt) ? value.attempt : 1,
    reason: typeof value.reason === 'string' ? value.reason : null,
    ...(typeof value.placeholder === 'string' ? { placeholder: value.placeholder } : {}),
  };
  if (value.inputType === 'choice') {
    const choices = readOptions(value.choices);
    if (choices === null) return { ...base, kind: 'unsupported', inputType: 'choice' };
    return { ...base, kind: 'choice', multiple: value.multiple === true, choices };
  }
  if (isKnownInputType(value.inputType)) return { ...base, kind: 'text', inputType: value.inputType as Exclude<InputType, 'choice'> };
  return { ...base, kind: 'unsupported', inputType: typeof value.inputType === 'string' ? value.inputType : '' };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Lee un evento del motor tal como llega de la API. Un `type` desconocido o una forma rota da `null` y se ignora sin
 * lanzar. En un `error` se descarta `message` aquí mismo: el resto del chat no puede leerlo.
 */
export function readEvent(value: unknown): ChatEvent | null {
  if (!isObject(value) || typeof value.type !== 'string' || !(KNOWN_EVENT_TYPES as readonly string[]).includes(value.type)) return null;
  const nodeId = typeof value.nodeId === 'string' ? value.nodeId : null;
  if (nodeId === null) return null;
  switch (value.type) {
    case 'message':
      return { type: 'message', nodeId, content: readContent(value.content), typingDelayMs: Math.max(0, nullableNumber(value.typingDelayMs) ?? 0) };
    case 'input': {
      const question = readPendingQuestion(value);
      return question === null ? null : { type: 'input', ...question };
    }
    case 'http':
      return { type: 'http', nodeId, attempts: nullableNumber(value.attempts) ?? 0, status: nullableNumber(value.status), error: nullableString(value.error) };
    case 'llm':
      return { type: 'llm', nodeId, turns: nullableNumber(value.turns) ?? 0, costUsd: nullableNumber(value.costUsd) ?? 0, reason: nullableString(value.reason) };
    case 'end':
      return { type: 'end', nodeId, outcome: nullableString(value.outcome) };
    case 'error':
      return typeof value.code === 'string' ? { type: 'error', nodeId, code: value.code } : null;
    default:
      return null;
  }
}

/** Lee la lista de eventos de un avance, ignorando lo desconocido. */
export function readEvents(value: unknown): ChatEvent[] {
  if (!Array.isArray(value)) return [];
  const events: ChatEvent[] = [];
  for (const raw of value as unknown[]) {
    const event = readEvent(raw);
    if (event !== null) events.push(event);
  }
  return events;
}
