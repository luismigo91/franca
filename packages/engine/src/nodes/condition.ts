import { evaluatePredicate, InvalidRuleError } from '../predicates.js';
import type { NodeExecutor } from './types.js';

/** Continúa en el `next` de la primera regla verdadera o en `else`; una regla no evaluable falla la sesión. */
export const executeCondition: NodeExecutor<'condition'> = (node, ctx) => {
  const lookup = (name: string) => ctx.vars.get(name);
  try {
    for (const rule of node.rules) {
      if (evaluatePredicate(rule.when, lookup)) return { kind: 'next', nodeId: rule.next };
    }
    return { kind: 'next', nodeId: node.else };
  } catch (error) {
    if (error instanceof InvalidRuleError) return { kind: 'fail', code: 'invalid_rule', message: error.message };
    throw error;
  }
};
