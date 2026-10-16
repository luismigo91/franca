import type { Flow, Node } from '@franca/spec';
import { DEFAULT_TYPING_DELAY_MS, MAX_STEPS_PER_ADVANCE } from './constants.js';
import { EXECUTORS } from './nodes/index.js';
import type { NodeExecutor, StepContext, StepOutcome } from './nodes/types.js';
import { buildState } from './state.js';
import type { EngineEvent, EngineHost, SessionResult } from './types.js';
import type { VariableStore } from './variables.js';

/**
 * Ejecuta nodos encadenados desde `startNodeId` hasta que la sesión termina o falla.
 *
 * @param flow Flujo ya validado (forma JSON).
 * @param vars Almacén de variables de esta operación.
 * @param startNodeId Nodo donde empieza.
 * @param host Capacidades del host.
 * @returns El resultado, con eventos en orden y el estado final.
 */
export async function run(flow: Flow, vars: VariableStore, startNodeId: string, host: EngineHost): Promise<SessionResult> {
  const nodes = new Map<string, Node>(flow.nodes.map((node) => [node.id, node]));
  const events: EngineEvent[] = [];
  const ctx: StepContext = {
    vars,
    host,
    typingDelayMs: flow.settings?.typingDelayMs ?? DEFAULT_TYPING_DELAY_MS,
    emit: (event) => void events.push(event),
  };

  let nodeId = startNodeId;
  for (let steps = 0; ; steps++) {
    // El límite se comprueba antes de mirar el tipo del nodo: gana a `unsupported_node`.
    const outcome: StepOutcome =
      steps >= MAX_STEPS_PER_ADVANCE
        ? { kind: 'fail', code: 'step_limit_exceeded', message: `se superó el límite de ${MAX_STEPS_PER_ADVANCE} nodos por avance` }
        : await execute(nodes.get(nodeId)!, ctx);

    if (outcome.kind === 'next') {
      nodeId = outcome.nodeId;
      continue;
    }
    if (outcome.kind === 'end') {
      events.push({ type: 'end', nodeId, outcome: outcome.outcome });
      const state = buildState(flow, vars, { status: 'ended', nodeId, outcome: outcome.outcome, error: null });
      return { ok: true, status: 'ended', events, state };
    }
    events.push({ type: 'error', nodeId, code: outcome.code, message: outcome.message });
    const state = buildState(flow, vars, {
      status: 'failed',
      nodeId,
      outcome: null,
      error: { code: outcome.code, nodeId },
    });
    return { ok: true, status: 'failed', events, state };
  }
}

async function execute(node: Node, ctx: StepContext): Promise<StepOutcome> {
  // Único punto donde se pierde la correlación tipo de nodo ↔ ejecutor; la tabla ya la garantiza.
  const executor = EXECUTORS[node.type] as NodeExecutor<Node['type']>;
  return executor(node as never, ctx);
}
