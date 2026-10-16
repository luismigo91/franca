import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { LlmSlotRequest, VariableType } from '@franca/engine';
import * as z from 'zod/v4';
import { slotKey } from './prompt.js';

/**
 * El `value` de un slot, de tipo fijo (un slot de tipo `json` se pide como texto JSON: un esquema
 * cerrado no admite un objeto libre). Sin uniones: la API limita a 16 parámetros con tipo unión.
 */
function valueSchema(type: VariableType): z.ZodType {
  switch (type) {
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    default:
      return z.string();
  }
}

/**
 * El esquema de la salida de una petición: el texto, `done` y, por slot, un objeto requerido
 * `{ found, value }` con clave posicional. Sin uniones (`[T, "null"]`) ni propiedades opcionales: la API
 * admite 16 y 24 por petición, y un nodo puede tener más slots. El `value` de un slot con `found` `false`
 * se ignora.
 */
export function buildOutputSchema(slots: readonly LlmSlotRequest[]) {
  return z.object({
    text: z.string(),
    done: z.boolean(),
    slots: z.object(Object.fromEntries(slots.map((slot, index) => [slotKey(index), z.object({ found: z.boolean(), value: valueSchema(slot.type) })]))),
  });
}

export type OutputSchema = ReturnType<typeof buildOutputSchema>;

/** El `output_config.format` de la petición: el JSON Schema que genera `zodOutputFormat`, sin la función de parseo. */
export function buildOutputFormat(slots: readonly LlmSlotRequest[], schema: OutputSchema = buildOutputSchema(slots)): { type: 'json_schema'; schema: Record<string, unknown> } {
  return { type: 'json_schema', schema: zodOutputFormat(schema).schema };
}

export interface StructuredOutput {
  text: string;
  done: boolean;
  /** Solo los slots con `found` `true`, con el nombre de su variable (también `__proto__` o `constructor`). */
  slots: Record<string, unknown>;
}

/** El texto de los bloques `text` posteriores al último bloque `fallback` (o de todos, si no hay). */
function outputText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  let from = 0;
  content.forEach((item, index) => {
    if (typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'fallback') from = index + 1;
  });
  const texts = content.slice(from).flatMap((item) => {
    if (typeof item !== 'object' || item === null || (item as { type?: unknown }).type !== 'text') return [];
    const text = (item as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  });
  return texts.length === 0 ? null : texts.join('');
}

/**
 * Lee la salida estructurada de una respuesta con `stop_reason` `end_turn`: une los bloques `text`
 * posteriores al último `fallback`, los parsea como JSON y los valida con el esquema de la petición.
 * Un slot con `found` `false` no se incluye; uno `json` se parsea y, si no es JSON o es `null`, tampoco. El resto
 * pasa tal cual (la conversión es del motor). Los pensamientos y los demás bloques se ignoran.
 *
 * @param content El `content` de la respuesta (sin tipar).
 * @param slots Los slots de la petición.
 * @returns La salida, o `null` si no es JSON o no cumple el esquema.
 */
export function readStructuredOutput(content: unknown, slots: readonly LlmSlotRequest[], schema: OutputSchema = buildOutputSchema(slots)): StructuredOutput | null {
  const raw = outputText(content);
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return null;
  const entries: [string, unknown][] = [];
  slots.forEach((slot, index) => {
    const slotOutput = (parsed.data.slots as Record<string, { found: boolean; value: unknown }>)[slotKey(index)]!;
    if (!slotOutput.found) return;
    let value: unknown = slotOutput.value;
    if (slot.type === 'json') {
      try {
        value = JSON.parse(value as string);
      } catch {
        return;
      }
      if (value === null) return;
    }
    entries.push([slot.name, value]);
  });
  return { text: parsed.data.text, done: parsed.data.done, slots: Object.fromEntries(entries) };
}
