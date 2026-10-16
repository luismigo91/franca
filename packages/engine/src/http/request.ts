import type { Flow, HttpNode } from '@franca/spec';
import { DEFAULT_HTTP_TIMEOUT_MS, MAX_REQUEST_BODY_LENGTH } from '../constants.js';
import { measureTemplate, renderTemplate, templateVariables } from '../template.js';
import type { HttpErrorReason } from '../constants.js';
import type { HttpMethod, HttpRequest, HttpRequestHeader, VariableValue } from '../types.js';
import { buildRequestUrl } from './url.js';

type Lookup = (name: string) => VariableValue | undefined;

/** Lo que `prepareRequest` calcula una vez por llegada al nodo; cada intento deriva de ello un `HttpRequest` nuevo. */
export interface PreparedRequest {
  nodeId: string;
  method: HttpMethod;
  url: string;
  headers: HttpRequestHeader[];
  body: string | null;
  timeoutMs: number;
  containsPii: boolean;
}

export type Preparation =
  | { ok: true; request: PreparedRequest }
  | { ok: false; reason: Extract<HttpErrorReason, 'invalid_url' | 'invalid_header_value' | 'body_too_large'> };

/** Contador opcional (solo tests) de lo que retiene el render del body. */
export interface RequestStats {
  maxRetained: number;
}

/** Solo U+0021-U+007E, espacio y tabulador: así un valor insertado no puede añadir cabeceras ni partir la petición. */
function isHeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code !== 0x20 && code !== 0x09 && (code < 0x21 || code > 0x7e)) return false;
  }
  return true;
}

interface BodyRender {
  /** `true` en cuanto la suma de los strings renderizados supera `MAX_REQUEST_BODY_LENGTH`. */
  overflow: boolean;
  retained: number;
  built: unknown;
}

/**
 * Renderiza los strings del body (las claves no) con memoria acotada: la serialización JSON mide al
 * menos la suma de las longitudes de sus strings, así que al superar `MAX_REQUEST_BODY_LENGTH`
 * `body_too_large` ya es seguro y se deja de retener texto; los strings que quedan se **miden**
 * sin construirlos, para conservar el `value_too_large` de uno posterior. Lo retenido queda
 * acotado por `MAX_REQUEST_BODY_LENGTH` + `MAX_RENDERED_LENGTH`. La recursión es segura: el
 * flujo tiene como mucho `MAX_NESTING_DEPTH` niveles.
 */
function renderBody(body: unknown, lookup: Lookup, templates: string[], stats?: RequestStats): BodyRender {
  const state: BodyRender = { overflow: false, retained: 0, built: undefined };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      templates.push(value); // las plantillas de `containsPii`, recogidas en el mismo recorrido
      if (state.overflow) {
        measureTemplate(value, lookup);
        return '';
      }
      const text = renderTemplate(value, lookup);
      state.retained += text.length;
      if (stats) stats.maxRetained = Math.max(stats.maxRetained, state.retained);
      if (state.retained > MAX_REQUEST_BODY_LENGTH) {
        state.overflow = true;
        return '';
      }
      return text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
    }
    return value;
  };
  state.built = walk(body);
  return state;
}

/**
 * Construye la petición de un nodo `http`. Renderiza primero los textos acotados (valores de
 * cabecera y strings del body: `ValueTooLargeError` si alguno pasa de 16384) y después comprueba,
 * en el orden de la spec, URL, valores de cabecera y tamaño del body.
 *
 * @param node Nodo `http` (forma JSON).
 * @param lookup Valor actual de una variable.
 * @param piiVariables Variables personales (ver `personalVariables`).
 * @param stats Contador opcional de lo retenido (para tests).
 * @returns La petición lista, o el motivo por el que no se puede construir (`onError` sin llamar al host).
 * @throws {ValueTooLargeError} Si un valor de cabecera o un string del body renderizado supera `MAX_RENDERED_LENGTH`.
 */
export function prepareRequest(
  node: HttpNode,
  lookup: Lookup,
  piiVariables: ReadonlySet<string>,
  stats?: RequestStats,
): Preparation {
  const { request } = node;
  const headers: HttpRequestHeader[] = [];
  const templates = [request.url];
  for (const [name, raw] of Object.entries(request.headers ?? {})) {
    if (typeof raw === 'string') {
      templates.push(raw);
      headers.push({ name, value: renderTemplate(raw, lookup) });
    } else {
      headers.push({ name, secret: raw.secret });
    }
  }
  const body: unknown = request.body;
  const hasBody = body !== undefined && body !== null;
  let rendered: BodyRender | undefined;
  if (hasBody) rendered = renderBody(body, lookup, templates, stats);

  const url = buildRequestUrl(request.url, lookup);
  if (!url.ok) return { ok: false, reason: 'invalid_url' };
  for (const header of headers) {
    if ('value' in header && !isHeaderValue(header.value)) return { ok: false, reason: 'invalid_header_value' };
  }
  let serialized: string | null = null;
  if (rendered) {
    if (rendered.overflow) return { ok: false, reason: 'body_too_large' };
    serialized = JSON.stringify(rendered.built);
    if (serialized.length > MAX_REQUEST_BODY_LENGTH) return { ok: false, reason: 'body_too_large' };
    if (!headers.some((header) => header.name.toLowerCase() === 'content-type')) {
      headers.push({ name: 'Content-Type', value: 'application/json' });
    }
  }
  const containsPii = templates.some((template) => templateVariables(template).some((name) => piiVariables.has(name)));
  return {
    ok: true,
    request: {
      nodeId: node.id,
      method: request.method,
      url: url.url,
      headers,
      body: serialized,
      timeoutMs: node.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
      containsPii,
    },
  };
}

/**
 * Petición de un intento: objeto y lista de cabeceras nuevos, para que lo que haga el host con
 * ellos no afecte a los intentos siguientes.
 */
export function requestFor(prepared: PreparedRequest, attempt: number): HttpRequest {
  return { ...prepared, headers: prepared.headers.map((header) => ({ ...header })), attempt };
}

/**
 * Variables personales de un flujo: las declaradas con `pii: true` (alguna declaración de ese
 * nombre) y, de forma transitiva, toda variable a la que algún `set` asigna un string cuya
 * plantilla nombra una personal. Es estático (todos los `set`, se ejecuten o no): el indicador
 * describe la petición, no un camino concreto. No se propaga por `input`, `condition` ni `responseMap`.
 *
 * Lineal en el tamaño del flujo: cada plantilla se analiza una sola vez para construir el grafo
 * «variable citada → variables que la copian», y una lista de trabajo lo recorre desde las `pii`.
 *
 * @param flow Flujo (forma JSON).
 * @returns Los nombres personales.
 */
export function personalVariables(flow: Flow): Set<string> {
  const personal = new Set((flow.variables ?? []).filter((variable) => variable.pii === true).map((variable) => variable.name));
  const copiedBy = new Map<string, string[]>();
  for (const node of flow.nodes) {
    if (node.type !== 'set') continue;
    for (const { variable, value } of node.assignments) {
      if (typeof value !== 'string') continue;
      for (const source of new Set(templateVariables(value))) {
        const targets = copiedBy.get(source) ?? [];
        targets.push(variable);
        copiedBy.set(source, targets);
      }
    }
  }
  const pending = [...personal];
  while (pending.length > 0) {
    for (const target of copiedBy.get(pending.pop()!) ?? []) {
      if (personal.has(target)) continue;
      personal.add(target);
      pending.push(target);
    }
  }
  return personal;
}
