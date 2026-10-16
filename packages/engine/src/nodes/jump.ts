import type { NodeExecutor } from './types.js';

/** Continúa en `target` sin emitir eventos ni tocar variables. */
export const executeJump: NodeExecutor<'jump'> = (node) => ({ kind: 'next', nodeId: node.target });
