/** Un problema del flujo: de forma (esquema) o semántico. */
export interface FlowIssue {
  layer: 'shape' | 'semantic';
  /** JSON Pointer dentro del flujo ('' es la raíz). */
  path: string;
  /** Nodo afectado, si el error es de un nodo concreto. */
  nodeId?: string;
  /** Solo lo lleva el issue final del tope de issues (`too_many_issues`); el resto no tiene código. */
  code?: 'too_many_issues';
  message: string;
}

/** Issues máximos que devuelve `validateFlow`; si hay más, el último avisa de que se recortó. */
export const MAX_FLOW_ISSUES = 100;

const COLLATOR = new Intl.Collator('en', { numeric: true });

/** Compara dos JSON Pointers con los índices en orden numérico (`/nodes/2` antes que `/nodes/10`). */
export function compareByPath(a: string, b: string): number {
  return COLLATOR.compare(a, b);
}

/** Comparador de issues y avisos por `path`. */
export const byPath = (a: { path: string }, b: { path: string }): number => compareByPath(a.path, b.path);

/**
 * Recorta una lista de issues al tope: los `MAX_FLOW_ISSUES` primeros y, si había más, el issue final
 * `too_many_issues` con la capa de los anteriores.
 *
 * @param issues Issues en el orden en que se muestran.
 * @param layer Capa del issue final.
 * @returns La misma lista si cabe; si no, los 100 primeros y el issue final.
 */
export function capIssues(issues: FlowIssue[], layer: FlowIssue['layer']): FlowIssue[] {
  if (issues.length <= MAX_FLOW_ISSUES) return issues;
  return [
    ...issues.slice(0, MAX_FLOW_ISSUES),
    { layer, path: '', code: 'too_many_issues', message: 'hay más errores: solo se muestran los 100 primeros' },
  ];
}
