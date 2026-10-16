import type { LlmTurnResult } from '../types.js';
import { copyJsonValue } from './json-copy.js';
import type { SlotSpec } from './slots.js';

/** Los `kind` válidos, atados a `LlmTurnResult['kind']` (un valor que no esté en el tipo no compila). */
export const LLM_RESULT_KINDS = ['turn', 'refusal', 'failed', 'not_configured'] as const satisfies readonly LlmTurnResult['kind'][];

/** Resultado ya leído: los valores de los slots declarados se han leído una vez y, si son `json`, copiado. */
export type TurnResult =
  | { kind: 'turn'; text: string; values: Map<string, unknown>; done: boolean; costUsd: number }
  | { kind: 'refusal'; costUsd: number }
  | { kind: 'failed'; costUsd: number }
  | { kind: 'not_configured' };

const isCost = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Lee lo que resolvió el host. Cada propiedad se lee **una sola vez** a una variable local, y solo
 * las del `kind`: lo que añada el host no se toca. De `slots` solo se leen los nombres declarados
 * por el nodo (`Object.hasOwn` y una lectura): nunca se enumera ni se usa `in`, así que una clave
 * ajena no se lee, una heredada no cuenta y el coste es O(slots del nodo). Un valor de un slot
 * `json` se copia aquí, dentro del mismo `try`, con `copyJsonValue`.
 *
 * @param raw Lo que resolvió (o devolvió) el host.
 * @param specs Slots del nodo (`slotSpecs`).
 * @returns El resultado, o `null` si está fuera de contrato o si leer algo lanza (→ `llm_host_error`).
 */
export function readTurnResult(raw: unknown, specs: readonly SlotSpec[]): TurnResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  try {
    const kind = source.kind;
    switch (kind) {
      case 'turn': {
        const text = source.text;
        const slots = source.slots;
        const done = source.done;
        const costUsd = source.costUsd;
        if (typeof text !== 'string' || typeof done !== 'boolean' || !isCost(costUsd)) return null;
        if (typeof slots !== 'object' || slots === null || Array.isArray(slots)) return null;
        return { kind, text, values: readSlotValues(slots as Record<string, unknown>, specs), done, costUsd: costUsd === 0 ? 0 : costUsd };
      }
      case 'refusal':
      case 'failed': {
        const costUsd = source.costUsd;
        return isCost(costUsd) ? { kind, costUsd: costUsd === 0 ? 0 : costUsd } : null;
      }
      case 'not_configured':
        return { kind };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function readSlotValues(slots: Record<string, unknown>, specs: readonly SlotSpec[]): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const declared = specs.filter((spec) => Object.hasOwn(slots, spec.name));
  for (const spec of declared) {
    const value = slots[spec.name];
    if (spec.type !== 'json' || value === null || value === undefined) {
      values.set(spec.name, value);
      continue;
    }
    const copy = copyJsonValue(value);
    if (copy.ok) values.set(spec.name, copy.value);
  }
  return values;
}
