import { ConfigError } from '../config/app-config.js';

/** Token de inyección de la configuración de las conversaciones ya validada. */
export const CONVERSATIONS_CONFIG = Symbol('CONVERSATIONS_CONFIG');

export interface ConversationsConfig {
  /** Clave de Claude de `FRANCA_ANTHROPIC_API_KEY`; `null` si falta o está vacía. Nunca se imprime. */
  anthropicApiKey: string | null;
  /** Presupuesto de coste `llm` por conversación, en dólares: de 0 (excluido) a 1000. */
  costLimitUsd: number;
}

/** Presupuesto por conversación cuando `FRANCA_CONVERSATION_COST_LIMIT_USD` no está definida. */
export const DEFAULT_COST_LIMIT_USD = 0.5;
const MAX_COST_LIMIT_USD = 1000;
/** Dígitos y como mucho un punto, con al menos un dígito (`0.5`, `2`, `.5`, `5.`; no `.`, `1e3`, `-1` ni espacios). */
const DECIMAL = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/;

/**
 * Lee y valida la configuración de las conversaciones.
 *
 * `FRANCA_ANTHROPIC_API_KEY` ausente o vacía da `null` (sin proveedor `llm`); definida, se toma tal cual.
 * `FRANCA_CONVERSATION_COST_LIMIT_USD` ausente vale 0.50; definida debe cumplir la regla aunque esté vacía.
 * Las variables del SDK de Anthropic (`ANTHROPIC_*`) no se leen: no configuran nada.
 *
 * @param env Variables de entorno (`process.env`).
 * @returns La configuración validada.
 * @throws {ConfigError} Si el presupuesto no es válido; el mensaje nombra la variable, nunca su valor.
 */
export function loadConversationsConfig(env: Record<string, string | undefined>): ConversationsConfig {
  const key = env.FRANCA_ANTHROPIC_API_KEY;
  return { anthropicApiKey: key === undefined || key === '' ? null : key, costLimitUsd: readCostLimit(env.FRANCA_CONVERSATION_COST_LIMIT_USD) };
}

function readCostLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_COST_LIMIT_USD;
  const limit = DECIMAL.test(value) ? Number(value) : Number.NaN;
  if (limit > 0 && limit <= MAX_COST_LIMIT_USD) return limit;
  throw new ConfigError(
    'FRANCA_CONVERSATION_COST_LIMIT_USD no es válida: debe ser un decimal mayor que 0 y de 1000 como mucho, escrito con dígitos y como mucho un punto (por ejemplo 0.5 o 2).',
  );
}
