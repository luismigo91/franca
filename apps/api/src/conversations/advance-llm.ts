import { createLlmCapability, type LlmCapability, type LlmTurnRequest, type LlmTurnResult } from '@franca/engine';
import { LLM_WINDOW_MS } from './conversation-timing.js';

export interface AdvanceLlmOptions {
  /** Proveedores de la instalación (nombre → capacidad). */
  providers: ReadonlyMap<string, LlmCapability>;
  /** Milisegundos del reloj de la API. */
  now: () => number;
  /** Instante (ms) en que empezó el avance. */
  startedAtMs: number;
  /** Presupuesto de coste de la conversación, en dólares. */
  budgetUsd: number;
  /** Coste ya contabilizado antes de este avance. */
  priorCostUsd: number;
}

export interface AdvanceLlm {
  /** La capacidad `llm` de este avance, para `buildEngineHost`. */
  capability: LlmCapability;
  /** Coste de los turnos resueltos en este avance. */
  spentUsd(): number;
  /** El presupuesto bloqueó algún turno de este avance. */
  limitReached(): boolean;
}

// Congelados: el mismo objeto se devuelve en cada turno y el motor no debe poder mutarlo para los siguientes.
const NOT_CONFIGURED: LlmTurnResult = Object.freeze({ kind: 'not_configured' });
const BLOCKED: LlmTurnResult = Object.freeze({ kind: 'failed', costUsd: 0 });

/** Resultados cuyo `costUsd` el proveedor dice haber gastado. */
const BILLED_KINDS: ReadonlySet<unknown> = new Set(['turn', 'refusal', 'failed']);

/**
 * Capacidad `llm` de **un** avance (también el de una creación). Por cada turno, en este orden:
 * 1. proveedor desconocido → `not_configured`, sin tocar presupuesto ni plazo (es configuración);
 * 2. pasados `LLM_WINDOW_MS` desde el inicio → `failed` de coste 0 sin llamar al proveedor;
 * 3. `priorCostUsd + gastado >= budgetUsd` → `failed` de coste 0 sin llamar, y `limitReached`;
 * 4. si no, llama al proveedor y suma el coste de los resultados `turn`/`refusal`/`failed` con un coste finito ≥ 0.
 *
 * Devuelve el resultado del proveedor **tal cual**: el motor decide si es válido. No captura el rechazo de un proveedor
 * (el motor lo convierte en `llm_host_error`) y no registra nada: ni peticiones, ni resultados, ni errores.
 *
 * @param options Proveedores, reloj, inicio del avance y presupuesto.
 * @returns La capacidad y sus contadores.
 */
export function createAdvanceLlm(options: AdvanceLlmOptions): AdvanceLlm {
  const routed = createLlmCapability(options.providers);
  let spent = 0;
  let reached = false;

  const capability: LlmCapability = async (request: LlmTurnRequest): Promise<LlmTurnResult> => {
    if (!options.providers.has(request.provider)) return NOT_CONFIGURED;
    if (options.now() - options.startedAtMs >= LLM_WINDOW_MS) return BLOCKED;
    if (options.priorCostUsd + spent >= options.budgetUsd) {
      reached = true;
      return BLOCKED;
    }
    const result = await routed(request);
    spent += billedCost(result);
    return result;
  };

  return { capability, spentUsd: () => spent, limitReached: () => reached };
}

/**
 * Coste que se suma de un resultado: lee `kind` y `costUsd` una sola vez y, si no es un coste finito ≥ 0 de un
 * resultado facturable, 0. Un resultado que lanza al leerse (un `Proxy`) no suma.
 */
function billedCost(result: unknown): number {
  try {
    const { kind, costUsd } = result as { kind: unknown; costUsd: unknown };
    return BILLED_KINDS.has(kind) && typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : 0;
  } catch {
    return 0;
  }
}
