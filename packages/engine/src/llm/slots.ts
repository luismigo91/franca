import type { LlmNode } from '@franca/spec';
import { checkTextAnswer } from '../input/answer.js';
import type { InputType, VariableType, VariableValue } from '../types.js';
import { copyJsonValue } from './json-copy.js';

/** Tipo de variable → conversor de `input`. El tipo mapeado falla si el esquema añade un `type`. */
export const SLOT_INPUT_TYPES: { readonly [K in VariableType]: Exclude<InputType, 'choice'> | 'json' } = {
  string: 'text',
  email: 'email',
  phone: 'phone',
  number: 'number',
  url: 'url',
  date: 'date',
  boolean: 'boolean',
  json: 'json',
};

/** Un slot del nodo con el `type` declarado de su variable. */
export interface SlotSpec {
  name: string;
  type: VariableType;
  description: string;
  required: boolean;
}

/** Sin `validation`: los slots se comprueban solo por formato. */
export const NO_RULES = { program: null } as const;

/**
 * Los slots del nodo sin repetir variable (cuenta el primero), en su orden y con el tipo declarado
 * de cada variable. Una pasada con un `Set`; los tipos vienen de un `Map` construido una vez por
 * operación, así que el coste es lineal en slots y variables.
 *
 * @param node Nodo `llm` (forma JSON).
 * @param variableTypes Tipo declarado de cada variable (la primera declaración manda).
 */
export function slotSpecs(node: Pick<LlmNode, 'slots'>, variableTypes: ReadonlyMap<string, VariableType>): SlotSpec[] {
  const seen = new Set<string>();
  const specs: SlotSpec[] = [];
  for (const slot of node.slots ?? []) {
    if (seen.has(slot.variable)) continue;
    seen.add(slot.variable);
    specs.push({
      name: slot.variable,
      type: variableTypes.get(slot.variable) ?? 'string',
      description: slot.description,
      required: slot.required !== false,
    });
  }
  return specs;
}

/**
 * Convierte el valor de un slot según el `type` declarado de su variable. Un string se comprueba
 * como la respuesta de un `input` del tipo equivalente (los mismos conversores: `1.500`, IPs en
 * `url`, más de 15 cifras… se rechazan igual); un number finito vale en `number` (`-0` como 0) y un
 * boolean en `boolean`. `null`, ausente o cualquier otra forma no se recoge. Un valor `json` llega ya
 * copiado y comprobado por `copyJsonValue`.
 *
 * @param type Tipo declarado de la variable.
 * @param value Valor del host (ya copiado si el tipo es `json`).
 * @param language Idioma del flujo (parte de `locale` antes del guion).
 * @returns El valor a recoger, o `undefined` si no se recoge.
 */
export function convertSlotValue(type: VariableType, value: unknown, language: string): VariableValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (type === 'json') return value as VariableValue;
  if (type === 'number' && typeof value === 'number') return Number.isFinite(value) ? (value === 0 ? 0 : value) : undefined;
  if (type === 'boolean' && typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const check = checkTextAnswer(value, SLOT_INPUT_TYPES[type] as Exclude<InputType, 'choice'>, language, NO_RULES);
  return check.ok ? check.value : undefined;
}

/**
 * Convierte los valores de un turno y devuelve los que se recogen, en el orden del nodo.
 *
 * @param values Valores leídos por `readTurnResult` (solo de slots declarados).
 */
export function collectSlots(values: ReadonlyMap<string, unknown>, specs: readonly SlotSpec[], language: string): Map<string, VariableValue> {
  const collected = new Map<string, VariableValue>();
  for (const spec of specs) {
    if (!values.has(spec.name)) continue;
    const converted = convertSlotValue(spec.type, values.get(spec.name), language);
    if (converted !== undefined) collected.set(spec.name, converted);
  }
  return collected;
}

/**
 * Al reanudar: descarta los recogidos que ya no son slots del nodo y vuelve a convertir los demás
 * con el tipo actual de su variable. Depende de que convertir sea idempotente sobre lo que ya
 * devolvió un conversor (hipótesis con test por tipo): si no, un valor válido desaparecería.
 *
 * @param collected Recogidos del estado (datos inertes).
 */
export function revalidateCollected(collected: Readonly<Record<string, VariableValue>>, specs: readonly SlotSpec[], language: string): Map<string, VariableValue> {
  const kept = new Map<string, VariableValue>();
  for (const spec of specs) {
    if (!Object.hasOwn(collected, spec.name)) continue;
    const stored = collected[spec.name];
    const value = spec.type === 'json' ? jsonOrUndefined(stored) : stored;
    const converted = convertSlotValue(spec.type, value, language);
    if (converted !== undefined) kept.set(spec.name, converted);
  }
  return kept;
}

function jsonOrUndefined(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  const copy = copyJsonValue(value);
  return copy.ok ? copy.value : undefined;
}

/** @returns `true` si todo slot obligatorio está recogido (vacío sin slots obligatorios). */
export const hasRequired = (specs: readonly SlotSpec[], collected: ReadonlyMap<string, VariableValue>): boolean =>
  specs.every((spec) => !spec.required || collected.has(spec.name));
