/**
 * Validación de forma por piezas (RFC-0001, capa `shape`).
 *
 * ajv con `allErrors` es cuadrático en arrays anchos de elementos que fallan, y `collapse` sobre todos los
 * errores de un flujo también. Por eso la forma se revisa por piezas: la raíz (sin `nodes`) y cada nodo contra
 * la definición de su tipo. Un validador `fast` (`allErrors: false`, lineal) decide si una pieza falla; solo si
 * es pequeña se revalida con `detailed` (`allErrors: true`) para dar todos sus errores, dentro de un presupuesto.
 * Detalle del diseño: `openspec/changes/archive/2026-10-17-api-flows/design.md`, D11.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import schema from '../flow.schema.json' with { type: 'json' };
import { isObject } from './is-object.js';
import { byPath, capIssues, compareByPath, MAX_FLOW_ISSUES, type FlowIssue } from './issues.js';

/** Caracteres máximos del texto JSON de una pieza para dar todos sus errores. */
export const SHAPE_DETAIL_MAX_CHARS = 8192;
/** Caracteres máximos que suman las piezas de las que se da todo el detalle. */
export const SHAPE_DETAIL_BUDGET_CHARS = 65536;

// Map y no objeto plano: un `type` como `constructor` o `__proto__` encontraría el prototipo de Object.
const NODE_DEFS: ReadonlyMap<string, string> = new Map([
  ['message', 'messageNode'],
  ['input', 'inputNode'],
  ['condition', 'conditionNode'],
  ['set', 'setNode'],
  ['http', 'httpNode'],
  ['llm', 'llmNode'],
  ['jump', 'jumpNode'],
  ['end', 'endNode'],
]);

interface Validators {
  /** El esquema completo. */
  full: ValidateFunction;
  /** La raíz del flujo con `nodes` reducido a «un array no vacío». */
  root: ValidateFunction;
  /** La definición de un tipo de nodo (`messageNode`…). */
  node(def: string): ValidateFunction;
}

function createValidators(allErrors: boolean): Validators {
  const ajv = new Ajv2020({ allErrors, strictTypes: false });
  ajv.addSchema(schema);
  const full = ajv.getSchema(schema.$id)!;
  // La raíz sin nodos se deriva del esquema al cargar, sin copiar reglas a mano.
  const rootSchema = {
    ...structuredClone(schema),
    $id: `${schema.$id}:root`,
    properties: { ...schema.properties, nodes: { type: 'array', minItems: 1 } },
  };
  const root = ajv.compile(rootSchema);
  const nodes = new Map<string, ValidateFunction>();
  return {
    full,
    root,
    node(def) {
      let fn = nodes.get(def);
      if (!fn) {
        fn = ajv.compile({ $ref: `${schema.$id}#/$defs/${def}` });
        nodes.set(def, fn);
      }
      return fn;
    },
  };
}

const fast = createValidators(false);
const detailed = createValidators(true);

interface Budget {
  used: number;
}

/**
 * Issues de forma de un valor, ordenados por `path` y acotados por `MAX_FLOW_ISSUES`.
 *
 * @param value Valor recibido (cualquier JSON).
 * @returns `[]` si la forma es correcta.
 */
export function shapeIssues(value: unknown): FlowIssue[] {
  // `input` sin estrechar: el predicado de tipo de ajv lo dejaría en `never` tras el primer retorno.
  const input: unknown = value;
  if (fast.full(value)) return [];
  const fastErrors = fast.full.errors ?? [];
  const budget: Budget = { used: 0 };
  const rootIssues = checkPiece({
    value: input,
    measured: isObject(input) ? withoutNodes(input) : input,
    prefix: '',
    validators: (v) => v.root,
    budget,
  });
  const issues = [...rootIssues];
  const nodes = isObject(input) && Array.isArray(input.nodes) ? (input.nodes as unknown[]) : [];

  // Deja de revisar nodos cuando ya hay más issues de los que caben antes de lo que falta por ver.
  let ordered = rootIssues.filter((item) => compareByPath(item.path, '/nodes/') < 0).length;
  for (let index = 0; index < nodes.length && ordered <= MAX_FLOW_ISSUES; index++) {
    const found = nodeIssues(nodes[index], index, budget);
    for (const item of found) issues.push(item);
    ordered += found.length;
  }

  if (issues.length === 0) {
    // Defensa: la forma falla pero ninguna pieza lo dice; se da el primer error del esquema completo.
    const first = collapse(fastErrors)[0] ?? fastErrors[0];
    if (first) issues.push(toIssue(first));
  }
  return capIssues(issues.sort(byPath), 'shape');
}

function nodeIssues(node: unknown, index: number, budget: Budget): FlowIssue[] {
  const path = `/nodes/${index}`;
  const nodeId = isObject(node) && typeof node.id === 'string' ? node.id : undefined;
  const kind = isObject(node) ? node.type : undefined;
  const def = typeof kind === 'string' ? NODE_DEFS.get(kind) : undefined;
  if (!def) return [issue(path, `tipo de nodo desconocido: ${JSON.stringify(kind ?? null)}`, nodeId)];
  return checkPiece({ value: node, measured: node, prefix: path, nodeId, validators: (v) => v.node(def), budget });
}

interface Piece {
  value: unknown;
  /** Lo que se mide para decidir el detalle (la raíz sin `nodes`, o el propio nodo). */
  measured: unknown;
  prefix: string;
  nodeId?: string;
  validators: (set: Validators) => ValidateFunction;
  budget: Budget;
}

/** Errores de una pieza: todos si es pequeña y cabe en el presupuesto; si no, el primero de `fast`. */
function checkPiece(piece: Piece): FlowIssue[] {
  const quick = piece.validators(fast);
  if (quick(piece.value)) return [];
  const quickErrors = quick.errors ?? [];
  const size = textLength(piece.measured);
  if (size <= SHAPE_DETAIL_MAX_CHARS && piece.budget.used + size <= SHAPE_DETAIL_BUDGET_CHARS) {
    piece.budget.used += size;
    const full = piece.validators(detailed);
    full(piece.value);
    return collapse(full.errors ?? []).map((e) => toIssue(e, piece.prefix, piece.nodeId));
  }
  const first = collapse(quickErrors)[0] ?? quickErrors[0];
  return first ? [toIssue(first, piece.prefix, piece.nodeId)] : [];
}

function textLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function withoutNodes(root: Record<string, unknown>): Record<string, unknown> {
  const { nodes: _nodes, ...rest } = root;
  return rest;
}

/** Un issue de forma; las claves salen en el orden `layer`, `path`, `nodeId`, `message` y sin `nodeId` si no hay. */
function issue(path: string, message: string, nodeId?: string): FlowIssue {
  return nodeId === undefined ? { layer: 'shape', path, message } : { layer: 'shape', path, nodeId, message };
}

/**
 * Deja los errores en el nivel de detalle útil: quita los `if` (ya llega el error de su `then`/`else`) y
 * sustituye los `oneOf` fallidos por un único error, descartando los de cada rama. Lineal: un `Set` con las
 * rutas de los `oneOf` y, por error, un recorrido por sus antecesores.
 *
 * @param errors Errores de ajv de una pieza.
 * @returns Los errores que se muestran.
 */
export function collapse(errors: ErrorObject[]): ErrorObject[] {
  const oneOfPaths = new Set<string>();
  for (const e of errors) if (e.keyword === 'oneOf') oneOfPaths.add(e.instancePath);
  return errors.filter((e) => {
    if (e.keyword === 'if') return false;
    if (oneOfPaths.size === 0) return true;
    // Un oneOf se queda si no tiene otro oneOf antecesor; cualquier otro error se va si está dentro de uno.
    return !insideOneOf(e.instancePath, oneOfPaths, e.keyword !== 'oneOf');
  });
}

function insideOneOf(path: string, oneOfPaths: Set<string>, includeSelf: boolean): boolean {
  let current = includeSelf ? path : parentOf(path);
  while (current !== undefined) {
    if (oneOfPaths.has(current)) return true;
    current = parentOf(current);
  }
  return false;
}

function parentOf(path: string): string | undefined {
  return path === '' ? undefined : path.slice(0, path.lastIndexOf('/'));
}

function toIssue(e: ErrorObject, prefix = '', nodeId?: string): FlowIssue {
  return issue(prefix + e.instancePath, shapeMessage(e), nodeId);
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
