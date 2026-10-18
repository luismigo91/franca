import { capWarnings, type FlowValidationResult } from '@franca/spec';
import { asText } from '@/lib/editor/as-text';

/** Un problema (error) o aviso del validador, listo para la lista y las marcas. */
export interface Problem {
  kind: 'issue' | 'warning';
  message: string;
  /** JSON Pointer dentro del flujo (`''` es la raíz). */
  path: string;
  /** Nodo afectado, si lo hay. */
  nodeId: string | null;
  /** `shape` (forma) o `semantic`; los avisos no tienen capa. */
  layer: 'shape' | 'semantic' | null;
}

/**
 * Los problemas y avisos que se muestran: los issues y los avisos recortados con `capWarnings` (para mostrar; las
 * decisiones usan la lista completa).
 *
 * @param verdict El veredicto de `validateFlow`.
 */
export function problemsOf(verdict: FlowValidationResult): Problem[] {
  const issues: Problem[] = verdict.issues.map((issue) => ({
    kind: 'issue',
    message: issue.message,
    path: issue.path,
    nodeId: issue.nodeId === undefined ? null : asText(issue.nodeId),
    layer: issue.layer,
  }));
  const warnings: Problem[] = capWarnings(verdict.warnings).map((warning) => ({
    kind: 'warning',
    message: warning.message,
    path: warning.path,
    nodeId: warning.nodeId === undefined ? null : asText(warning.nodeId),
    layer: null,
  }));
  return [...issues, ...warnings];
}

/** Indica si algún issue es de forma (la semántica no corre hasta corregirlos). */
export function hasShapeProblems(verdict: FlowValidationResult): boolean {
  return verdict.issues.some((issue) => issue.layer === 'shape');
}

/** Problemas y avisos de cada nodo, por `nodeId` (un `Map`: un id como `constructor` es una clave más). */
export function problemsByNode(problems: readonly Problem[]): Map<string, { issues: number; warnings: number }> {
  const byNode = new Map<string, { issues: number; warnings: number }>();
  for (const problem of problems) {
    if (problem.nodeId === null) continue;
    const entry = byNode.get(problem.nodeId) ?? { issues: 0, warnings: 0 };
    if (problem.kind === 'issue') entry.issues += 1;
    else entry.warnings += 1;
    byNode.set(problem.nodeId, entry);
  }
  return byNode;
}

/** Problemas cuyo `path` es el puntero de un campo o cuelga de él (por segmentos: `/a/b` no cuelga de `/a/bc`). */
export function problemsAt(problems: readonly Problem[], pointer: string): Problem[] {
  return problems.filter((problem) => problem.path === pointer || problem.path.startsWith(`${pointer}/`));
}

/** «3 problemas y 1 aviso», «1 problema», «2 avisos» o «Sin problemas». */
export function summarizeProblems(problems: readonly Problem[]): string {
  const issues = problems.filter((problem) => problem.kind === 'issue').length;
  const warnings = problems.length - issues;
  const parts: string[] = [];
  if (issues > 0) parts.push(`${issues} ${issues === 1 ? 'problema' : 'problemas'}`);
  if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}`);
  return parts.length === 0 ? 'Sin problemas' : parts.join(' y ');
}

/** Dónde está un problema, en palabras: su nodo, o «Flujo» si es del flujo entero. */
export function problemPart(problem: Problem): string {
  return problem.nodeId ?? 'Flujo';
}
