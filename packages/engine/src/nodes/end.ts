import { ValueTooLargeError } from '../template.js';
import { renderContent, VALUE_TOO_LARGE } from './message.js';
import type { NodeExecutor } from './types.js';

/** Emite el `message` del contenido, si lo hay, y termina con el `outcome` (o `null`). */
export const executeEnd: NodeExecutor<'end'> = (node, ctx) => {
  try {
    if (node.content) {
      const content = renderContent(node.content, ctx);
      ctx.emit({ type: 'message', nodeId: node.id, content, typingDelayMs: ctx.typingDelayMs });
    }
    return { kind: 'end', outcome: node.outcome ?? null };
  } catch (error) {
    if (error instanceof ValueTooLargeError) return VALUE_TOO_LARGE;
    throw error;
  }
};
