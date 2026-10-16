import type { StepOutcome } from './types.js';

/** Ejecutor de los nodos que aún no se soportan (`input`, `http`, `llm`): la sesión falla. */
export const executeUnsupported = (node: { type: string }): StepOutcome => ({
  kind: 'fail',
  code: 'unsupported_node',
  message: `el nodo de tipo ${node.type} aún no está soportado`,
});
