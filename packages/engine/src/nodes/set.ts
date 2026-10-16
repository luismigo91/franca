import { renderTemplate, ValueTooLargeError } from '../template.js';
import { VALUE_TOO_LARGE } from './message.js';
import type { NodeExecutor } from './types.js';

/** Aplica las asignaciones en orden (cada una ve las anteriores) y continúa en `next`, sin eventos. */
export const executeSet: NodeExecutor<'set'> = (node, ctx) => {
  const lookup = (name: string) => ctx.vars.get(name);
  for (const { variable, value } of node.assignments) {
    try {
      ctx.vars.set(variable, typeof value === 'string' ? renderTemplate(value, lookup) : value);
    } catch (error) {
      if (error instanceof ValueTooLargeError) return VALUE_TOO_LARGE;
      throw error;
    }
  }
  return { kind: 'next', nodeId: node.next };
};
