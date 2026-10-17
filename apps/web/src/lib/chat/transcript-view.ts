import { TRANSCRIPT_MAX_RESTARTS } from '@/config/limits';
import type { Page, TranscriptItem } from '@/lib/chat/api-types';
import type { ChatErrorCode } from '@/lib/chat/copy';
import { readEvent, readPendingQuestion, type ChoiceOption, type ContentItem, type ErrorActivityEvent, type HttpActivityEvent, type LlmActivityEvent, type PendingQuestion } from '@/lib/chat/events';
import type { ClientResult } from '@/lib/web-client';

/** Un elemento de la conversación visible: un mensaje del flujo o una respuesta del usuario. */
export type TimelineItem = { kind: 'flow'; key: string; nodeId: string; content: ContentItem[] } | { kind: 'user'; key: string; text: string };

/** Un elemento de la actividad técnica del panel: nunca lleva el `message` de un `error`. */
export type ActivityItem = HttpActivityEvent | LlmActivityEvent | ErrorActivityEvent;

export interface TranscriptView {
  timeline: TimelineItem[];
  activity: ActivityItem[];
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Texto con el que se pinta una respuesta del usuario (D12). `{text}` va tal cual; `{choice}` y `{choices}` se pintan con
 * el `label` de la opción en la pregunta anterior (en el orden de las opciones, separados por «, »); un `id` que no
 * está se pinta como su `id`. Una forma desconocida no se pinta (`null`).
 *
 * @param input Lo que guardó la transcripción.
 * @param options Opciones del último `input` anterior, o `null` si no hubo un `choice`.
 */
export function userInputText(input: unknown, options: readonly ChoiceOption[] | null): string | null {
  if (!isObject(input)) return null;
  const labelOf = (id: string) => options?.find((option) => option.id === id)?.label ?? id;
  if (typeof input.text === 'string') return input.text;
  if (typeof input.choice === 'string') return labelOf(input.choice);
  if (Array.isArray(input.choices) && input.choices.every((id) => typeof id === 'string')) {
    const chosen = new Set(input.choices as string[]);
    const known = (options ?? []).filter((option) => chosen.has(option.id)).map((option) => option.label);
    const unknown = (input.choices as string[]).filter((id) => !options?.some((option) => option.id === id));
    return [...known, ...unknown].join(', ');
  }
  return null;
}

/**
 * Reconstruye la conversación desde la transcripción (D12): ordena por `seq`, pinta cada `content` de un `message` y cada
 * entrada del usuario, y manda `http`, `llm` y `error` (sin `message`) a la actividad. Ni `http` ni `llm` van al
 * `timeline`. Lo desconocido se ignora.
 *
 * @param items Todas las entradas de la transcripción, en cualquier orden.
 */
export function buildTranscriptView(items: readonly TranscriptItem[]): TranscriptView {
  const timeline: TimelineItem[] = [];
  const activity: ActivityItem[] = [];
  let options: ChoiceOption[] | null = null;
  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    if (item.role === 'user') {
      const text = userInputText(item.input, options);
      if (text !== null) timeline.push({ kind: 'user', key: `t${item.seq}`, text });
      continue;
    }
    const event = readEvent(item.event);
    if (event === null) continue;
    switch (event.type) {
      case 'message':
        timeline.push({ kind: 'flow', key: `t${item.seq}`, nodeId: event.nodeId, content: event.content });
        break;
      case 'input':
        options = event.kind === 'choice' ? event.choices : null;
        break;
      case 'http':
      case 'llm':
      case 'error':
        activity.push(event);
        break;
      case 'end':
        break;
    }
  }
  return { timeline, activity };
}

/** Lee una página de la transcripción: el cliente real o uno falso en los tests. */
export type TranscriptPageReader = (offset: number) => Promise<ClientResult<Page<TranscriptItem>>>;

/**
 * Lee la transcripción entera, página a página (D12). Si `total` cambia entre páginas, empieza de nuevo (como mucho
 * `TRANSCRIPT_MAX_RESTARTS` veces; si no, `invalid_api_response`). Si una página falla, devuelve ese fallo.
 *
 * @param readPage Lee la página que empieza en `offset`.
 * @returns Todas las entradas, o el primer fallo.
 */
export async function readFullTranscript(readPage: TranscriptPageReader): Promise<ClientResult<TranscriptItem[]>> {
  for (let attempt = 0; attempt <= TRANSCRIPT_MAX_RESTARTS; attempt++) {
    const items: TranscriptItem[] = [];
    let total: number | null = null;
    let changed = false;
    for (;;) {
      const result = await readPage(items.length);
      if (!result.ok) return result;
      if (total !== null && result.body.total !== total) {
        changed = true;
        break;
      }
      total = result.body.total;
      items.push(...result.body.items);
      // Una página vacía antes de llegar al total no avanza: se da por leída (la lista pudo encogerse).
      if (items.length >= total || result.body.items.length === 0) break;
    }
    if (!changed) return { ok: true, status: 200, body: items };
  }
  return { ok: false, status: 200, code: 'invalid_api_response' satisfies ChatErrorCode };
}

/**
 * La pregunta pendiente es la del recurso, no el último `input` de la transcripción: el recurso manda (`null` si no
 * espera o caducó).
 */
export function pendingFromResource(resource: { status: string; pendingInput: unknown }): PendingQuestion | null {
  return resource.status === 'waiting' ? readPendingQuestion(resource.pendingInput) : null;
}
