import { validateFlow, type FlowIssue, type FlowValidationResult } from '@franca/spec';
import { isRecord } from '@/lib/editor/json-edit';
import { NODE_TYPE_LABELS } from '@/lib/editor/node-types';

/**
 * Valida un borrador con `validateFlow`, sin lanzar nunca. `validateFlow` lanza con un nodo cuyo `type` es el nombre de una
 * propiedad de `Object.prototype` (`constructor`, `toString`, `__proto__`…): busca el tipo en una tabla de objeto plano
 * (`packages/spec/src/shape.ts`, fuera del alcance de este cambio). Ese `type` es alcanzable con «Editar como JSON», y
 * una excepción en la validación en vivo rompería el editor. Si lanza, se da el mismo veredicto que da para un tipo
 * desconocido cualquiera: «tipo de nodo desconocido».
 *
 * @param flow El borrador (o cualquier valor que dé `JSON.parse`).
 */
export function validateDraft(flow: unknown): FlowValidationResult {
  try {
    return validateFlow(flow);
  } catch {
    const nodes: unknown[] = isRecord(flow) && Array.isArray(flow.nodes) ? (flow.nodes as unknown[]) : [];
    const issues: FlowIssue[] = [];
    nodes.forEach((node, index) => {
      if (!isRecord(node) || typeof node.type !== 'string' || NODE_TYPE_LABELS.has(node.type)) return;
      issues.push({
        layer: 'shape',
        path: `/nodes/${index}`,
        ...(typeof node.id === 'string' ? { nodeId: node.id } : {}),
        message: `tipo de nodo desconocido: ${JSON.stringify(node.type)}`,
      });
    });
    if (issues.length === 0) issues.push({ layer: 'shape', path: '', message: 'no se ha podido validar el flujo' });
    return { valid: false, issues, warnings: [] };
  }
}
