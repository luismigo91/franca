import type { StepOutcome } from './types.js';

/** Falla la sesión con `unsupported_node` cuando el host no ofrece la capacidad que pide un nodo (`http` o `llm`). */
export const executeUnsupported = (node: { type: string }): StepOutcome => ({
  kind: 'fail',
  code: 'unsupported_node',
  message: `el nodo de tipo ${node.type} aún no está soportado`,
});
