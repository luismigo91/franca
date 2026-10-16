/**
 * Validador de la spec de flujos de Franca v0.
 *
 * Capa 1 (shape): forma, contra flow.schema.json (JSON Schema 2020-12).
 * Capa 2 (semantic): reglas que el esquema no puede expresar. Solo se
 * evalúa si la forma es correcta.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import schema from '../flow.schema.json' with { type: 'json' };
import type { Flow, Node, Predicate } from './types.js';

export { schema };

export interface FlowIssue {
  layer: 'shape' | 'semantic';
  /** JSON Pointer dentro del flujo ('' es la raíz). */
  path: string;
  /** Nodo afectado, si el error es de un nodo concreto. */
  nodeId?: string;
  message: string;
}

export type FlowValidationResult =
  | { valid: true; flow: Flow; issues: [] }
  | { valid: false; issues: FlowIssue[] };

const NODE_DEFS: Record<string, string> = {
  message: 'messageNode',
  input: 'inputNode',
  condition: 'conditionNode',
  set: 'setNode',
  http: 'httpNode',
  llm: 'llmNode',
  jump: 'jumpNode',
  end: 'endNode',
};

const TEMPLATE_VAR = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
ajv.addSchema(schema);
const validateShape = ajv.getSchema(schema.$id)!;
const nodeValidators = new Map<string, ValidateFunction>();

function nodeValidator(def: string): ValidateFunction {
  let fn = nodeValidators.get(def);
  if (!fn) {
    fn = ajv.compile({ $ref: `${schema.$id}#/$defs/${def}` });
    nodeValidators.set(def, fn);
  }
  return fn;
}

export function validateFlow(input: unknown): FlowValidationResult {
  const shape = shapeIssues(input);
  if (shape.length) return { valid: false, issues: shape };
  const flow = input as Flow;
  const semantic = semanticIssues(flow);
  if (semantic.length) return { valid: false, issues: semantic };
  return { valid: true, flow, issues: [] };
}

// ---------------------------------------------------------------- forma

function shapeIssues(input: unknown): FlowIssue[] {
  if (validateShape(input)) return [];
  const errors = validateShape.errors ?? [];
  const nodes = isObject(input) && Array.isArray(input.nodes) ? (input.nodes as unknown[]) : [];

  // Un nodo mal formado falla el oneOf de `node` y ajv devuelve los errores
  // de las ocho ramas. Se revalida contra la definición de su tipo para dar
  // solo los errores que importan.
  const badNodes = new Set<number>();
  const issues: FlowIssue[] = [];
  for (const e of collapse(errors)) {
    const m = /^\/nodes\/(\d+)(?:\/|$)/.exec(e.instancePath);
    if (m && nodes.length) badNodes.add(Number(m[1]));
    else issues.push(toIssue(e));
  }
  for (const i of [...badNodes].sort((a, b) => a - b)) issues.push(...nodeShapeIssues(nodes[i], i));
  return issues.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
}

function nodeShapeIssues(node: unknown, index: number): FlowIssue[] {
  const path = `/nodes/${index}`;
  const nodeId = isObject(node) && typeof node.id === 'string' ? node.id : undefined;
  const kind = isObject(node) ? node.type : undefined;
  const def = typeof kind === 'string' ? NODE_DEFS[kind] : undefined;
  if (!def) {
    return [{ layer: 'shape', path, nodeId, message: `tipo de nodo desconocido: ${JSON.stringify(kind ?? null)}` }];
  }
  const validate = nodeValidator(def);
  validate(node);
  return collapse(validate.errors ?? []).map((e) => ({ ...toIssue(e, path), nodeId }));
}

/**
 * Deja los errores en el nivel de detalle útil: quita los `if` (ya llega el
 * error de su `then`/`else`) y sustituye los `oneOf` fallidos por un único
 * error, descartando los de cada rama.
 */
function collapse(errors: ErrorObject[]): ErrorObject[] {
  const oneOfPaths = errors.filter((e) => e.keyword === 'oneOf').map((e) => e.instancePath);
  return errors.filter((e) => {
    if (e.keyword === 'if') return false;
    if (e.keyword === 'oneOf') return !oneOfPaths.some((p) => p !== e.instancePath && isWithin(e.instancePath, p));
    return !oneOfPaths.some((p) => isWithin(e.instancePath, p));
  });
}

function isWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function toIssue(e: ErrorObject, prefix = ''): FlowIssue {
  return { layer: 'shape', path: prefix + e.instancePath, message: shapeMessage(e) };
}

function shapeMessage(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'required':
      return `falta la propiedad obligatoria '${p.missingProperty}'`;
    case 'additionalProperties':
      return `propiedad no permitida '${p.additionalProperty}'`;
    case 'unevaluatedProperties':
      return `propiedad no permitida '${p.unevaluatedProperty}'`;
    case 'const':
      return `debe ser ${JSON.stringify(p.allowedValue)}`;
    case 'enum':
      return `debe ser uno de: ${(p.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`;
    case 'type':
      return `debe ser de tipo ${p.type}`;
    case 'pattern':
      return `no cumple el patrón ${p.pattern}`;
    case 'minItems':
      return `debe tener al menos ${p.limit} elemento(s)`;
    case 'minLength':
      return `debe tener al menos ${p.limit} carácter(es)`;
    case 'maxLength':
      return `debe tener como mucho ${p.limit} carácter(es)`;
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      return `debe ser ${p.comparison} ${p.limit}`;
    case 'oneOf':
      return 'no coincide con ninguna de las formas permitidas';
    case 'not':
      // El único `not` del esquema es el `else` de inputNode; ajv da la ruta relativa a la definición.
      if (e.schemaPath === '#/else/not') return "'choices' solo se permite con inputType \"choice\"";
      return e.message ?? 'valor no permitido';
    default:
      return e.message ?? 'valor no válido';
  }
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

function predicateVars(p: Predicate): string[] {
  if ('variable' in p) return [p.variable];
  return ('all' in p ? p.all : p.any).flatMap(predicateVars);
}

function templateVars(value: unknown): string[] {
  if (typeof value === 'string') return [...value.matchAll(TEMPLATE_VAR)].map((m) => m[1]!);
  if (Array.isArray(value)) return value.flatMap(templateVars);
  if (isObject(value)) return Object.values(value).flatMap(templateVars);
  return [];
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
      else if (t.id === n.id && n.type !== 'llm') add(path + t.pointer, `${t.key} apunta a sí mismo`, n.id);
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
    if (n.type === 'condition') for (const r of n.rules) predicateVars(r.when).forEach((v) => used.add(v));
    const { id: _id, type: _type, position: _position, ...rest } = n;
    templateVars(rest).forEach((v) => used.add(v));
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
