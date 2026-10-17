/**
 * Validador de la spec de flujos de Franca v0.
 *
 * Capa 1 (shape): forma, contra flow.schema.json (JSON Schema 2020-12), por piezas (`shape.ts`).
 * Capa 2 (semantic): reglas que el esquema no puede expresar. Solo se
 * evalúa si la forma es correcta.
 * Además de los errores, informa de avisos (`warnings.ts`) que no impiden ejecutar el flujo.
 */
import schema from '../flow.schema.json' with { type: 'json' };
import { exceedsFlowDepth, MAX_FLOW_DEPTH } from './depth.js';
import { isObject } from './is-object.js';
import { capIssues, type FlowIssue } from './issues.js';
import { shapeIssues } from './shape.js';
import { TEMPLATE_VAR } from './template.js';
import type { Flow, Node, Predicate } from './types.js';
import { flowWarnings, type FlowWarning } from './warnings.js';

export { schema };
export type { FlowIssue };

export type FlowValidationResult =
  | { valid: true; flow: Flow; issues: []; warnings: FlowWarning[] }
  | { valid: false; issues: FlowIssue[]; warnings: FlowWarning[] };

/**
 * Valida un valor como flujo. No lanza con nada que produzca `JSON.parse`: la profundidad se comprueba antes
 * de cualquier recorrido; los issues están acotados (`MAX_FLOW_ISSUES`) y el coste es lineal con el tamaño.
 * `warnings` es la lista completa (sin recortar, ver `capWarnings`) y es `[]` si la forma es incorrecta.
 *
 * @param input Valor a validar (normalmente el resultado de `JSON.parse`).
 * @returns El flujo si es válido; si no, los issues.
 */
export function validateFlow(input: unknown): FlowValidationResult {
  if (exceedsFlowDepth(input)) {
    const message = `el flujo supera la profundidad máxima de anidamiento (${MAX_FLOW_DEPTH})`;
    return { valid: false, issues: [{ layer: 'shape', path: '', message }], warnings: [] };
  }
  const shape = shapeIssues(input);
  if (shape.length) return { valid: false, issues: shape, warnings: [] };
  const flow = input as Flow;
  const warnings = flowWarnings(flow);
  const semantic = semanticIssues(flow);
  if (semantic.length) return { valid: false, issues: capIssues(semantic, 'semantic'), warnings };
  return { valid: true, flow, issues: [], warnings };
}

// ------------------------------------------------------------- semántica

export interface Target {
  /** Campo del nodo que contiene el salto, legible: `next`, `rules[0].next`, `choices[grande].next`. */
  key: string;
  /** El mismo campo como JSON Pointer relativo al nodo. */
  pointer: string;
  /** Id del nodo destino. */
  id: string;
}

/** Saltos que puede dar un nodo. */
export function targets(node: Node): Target[] {
  const n = node as unknown as Record<string, unknown>;
  const out: Target[] = [];
  for (const key of ['next', 'else', 'onError', 'onExhausted', 'target']) {
    if (typeof n[key] === 'string') out.push({ key, pointer: `/${key}`, id: n[key] as string });
  }
  if (node.type === 'condition') {
    node.rules.forEach((r, i) => out.push({ key: `rules[${i}].next`, pointer: `/rules/${i}/next`, id: r.next }));
  }
  if (node.type === 'input') {
    (node.choices ?? []).forEach((c, i) => {
      if (c.next) out.push({ key: `choices[${c.id}].next`, pointer: `/choices/${i}/next`, id: c.next });
    });
  }
  return out;
}

function writtenVars(node: Node): string[] {
  switch (node.type) {
    case 'input':
      return [node.variable];
    case 'set':
      return node.assignments.map((a) => a.variable);
    case 'http':
      return (node.responseMap ?? []).map((m) => m.variable);
    case 'llm':
      return (node.slots ?? []).map((s) => s.variable);
    default:
      return [];
  }
}

/** Añade a `into` las variables que lee un predicado, con pila explícita (el anidamiento puede ser profundo). */
function collectPredicateVars(predicate: Predicate, into: Set<string>): void {
  const stack: Predicate[] = [predicate];
  while (stack.length) {
    const current = stack.pop()!;
    if ('variable' in current) into.add(current.variable);
    else for (const child of 'all' in current ? current.all : current.any) stack.push(child);
  }
}

/** Añade a `into` los nombres de los marcadores de todos los textos de un valor, con pila explícita y una pasada. */
function collectTemplateVars(value: unknown, into: Set<string>): void {
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === 'string') {
      for (const match of current.matchAll(TEMPLATE_VAR)) into.add(match[1]!);
    } else if (Array.isArray(current)) {
      for (const item of current) if (typeof item === 'string' || (typeof item === 'object' && item !== null)) stack.push(item);
    } else if (isObject(current)) {
      for (const item of Object.values(current)) if (typeof item === 'string' || (typeof item === 'object' && item !== null)) stack.push(item);
    }
  }
}

function semanticIssues(flow: Flow): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const add = (path: string, message: string, nodeId?: string) =>
    issues.push({ layer: 'semantic', path, nodeId, message });

  const byId = new Map<string, Node>();
  const indexOf = new Map<string, number>();
  flow.nodes.forEach((n, i) => {
    if (byId.has(n.id)) add(`/nodes/${i}/id`, `id de nodo duplicado: ${n.id}`, n.id);
    else {
      byId.set(n.id, n);
      indexOf.set(n.id, i);
    }
  });
  const declared = new Set((flow.variables ?? []).map((v) => v.name));

  if (!byId.has(flow.start)) add('/start', `start apunta a un nodo inexistente: ${flow.start}`);

  flow.nodes.forEach((n, i) => {
    const path = `/nodes/${i}`;
    for (const t of targets(n)) {
      if (!byId.has(t.id)) add(path + t.pointer, `${t.key} apunta a un nodo inexistente: ${t.id}`, n.id);
      // Un llm puede volver a sí mismo por `next` (otra vuelta de la conversación); por `onExhausted` no (ciclo sin tope).
      else if (t.id === n.id && (n.type !== 'llm' || t.key === 'onExhausted')) add(path + t.pointer, `${t.key} apunta a sí mismo`, n.id);
    }

    if (n.type === 'input' && n.inputType === 'choice' && n.choices) {
      const ids = n.choices.map((c) => c.id);
      if (new Set(ids).size !== ids.length) add(`${path}/choices`, 'ids de opción duplicados', n.id);
      if (!n.multiple && n.choices.some((c) => !c.next)) {
        add(`${path}/choices`, 'en selección única, cada opción necesita next', n.id);
      }
      if (n.multiple && !n.next) add(path, 'en selección múltiple, el nodo necesita next', n.id);
    }

    const used = new Set(writtenVars(n));
    if (n.type === 'condition') for (const r of n.rules) collectPredicateVars(r.when, used);
    const { id: _id, type: _type, position: _position, ...rest } = n;
    collectTemplateVars(rest, used);
    for (const v of [...used].filter((v) => !declared.has(v)).sort()) {
      add(path, `variable no declarada: ${v}`, n.id);
    }
  });

  const reachable = new Set<string>();
  const stack = byId.has(flow.start) ? [flow.start] : [];
  while (stack.length) {
    const cur = stack.pop()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const t of targets(byId.get(cur)!)) if (byId.has(t.id)) stack.push(t.id);
  }
  for (const id of byId.keys()) {
    if (!reachable.has(id)) add(`/nodes/${indexOf.get(id)}`, 'nodo inalcanzable desde start', id);
  }

  if (![...reachable].some((id) => byId.get(id)!.type === 'end')) add('/nodes', 'ningún nodo end es alcanzable');
  return issues;
}
