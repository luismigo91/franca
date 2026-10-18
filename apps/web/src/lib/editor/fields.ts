import { exceedsFlowDepth } from '@franca/spec';
import { descriptorAt, type FieldDescriptor, type ValueMode } from '@/lib/editor/node-fields';
import { getIn, isRecord, parsePointer, pointerOf, removeIn, setIn, type Change, type EditResult, type FlowDoc, type WriteOptions } from '@/lib/editor/json-edit';

// Traducción de lo que escribe un campo a una escritura en el JSON del flujo (D5): conserva el sitio de cada propiedad,
// no escribe los valores por defecto, vacía lo opcional quitando la propiedad y poda los contenedores opcionales vacíos.

export const DEPTH_ERROR = 'El JSON anida demasiados niveles: el máximo es 1000.';
export const NOT_JSON_ERROR = 'El texto no es JSON.';
export const DUPLICATE_HEADER_ERROR = 'Ya hay una cabecera con ese nombre.';

const ok = (flow: FlowDoc): EditResult => ({ ok: true, flow });
const fail = (error: string): EditResult => ({ ok: false, error });

const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;

/** Opciones de escritura de una edición: el tipo del contenedor sale del descriptor y la posición del último guardado. */
function options(flow: FlowDoc, saved: FlowDoc | null): WriteOptions {
  return {
    saved: saved ?? undefined,
    kindAt: (path) => {
      const descriptor = descriptorAt(flow, path);
      if (descriptor === null) return undefined;
      return descriptor.cls === 'list' || descriptor.cls === 'content' ? 'list' : 'object';
    },
  };
}

function write(flow: FlowDoc, saved: FlowDoc | null, pointer: string, value: unknown): FlowDoc {
  return setIn(flow, pointer, value, options(flow, saved));
}

function isEmptyContainer(value: unknown): boolean {
  return Array.isArray(value) ? value.length === 0 : isRecord(value) && Object.keys(value).length === 0;
}

/** Quita los contenedores opcionales que han quedado vacíos, salvo los que el último guardado ya tenía vacíos. */
function prune(flow: FlowDoc, saved: FlowDoc | null, path: readonly string[]): FlowDoc {
  let current = flow;
  let at = path;
  while (at.length > 0) {
    if (!isEmptyContainer(getIn(current, pointerOf(at)))) break;
    if (descriptorAt(current, at)?.prunable !== true) break;
    if (saved !== null && isEmptyContainer(getIn(saved, pointerOf(at)))) break;
    current = removeIn(current, pointerOf(at));
    at = at.slice(0, -1);
  }
  return current;
}

/** Quita una propiedad o un elemento y poda lo que deja vacío. */
function clear(flow: FlowDoc, saved: FlowDoc | null, pointer: string): FlowDoc {
  const segments = parsePointer(pointer);
  return prune(removeIn(flow, pointer), saved, segments.slice(0, -1));
}

/**
 * Texto (también plantillas): se escribe tal cual, sin recortar. Vacío en uno opcional quita la propiedad.
 *
 * @param pointer Puntero del campo en el flujo.
 * @param text Lo escrito.
 * @param required El campo es obligatorio: vacío se escribe `""` y lo señala el validador.
 */
export function writeText(pointer: string, text: string, required: boolean): Change {
  return (draft, saved) => ok(text === '' && !required ? clear(draft, saved, pointer) : write(draft, saved, pointer, text));
}

/**
 * Numérico: un número si el texto es decimal y finito; si no, el texto, para que lo señale el validador. Vacío en uno
 * opcional quita la propiedad.
 */
export function writeNumber(pointer: string, text: string, required: boolean): Change {
  return (draft, saved) => {
    if (text === '' && !required) return ok(clear(draft, saved, pointer));
    const parsed = DECIMAL.test(text) ? Number(text) : Number.NaN;
    return ok(write(draft, saved, pointer, Number.isFinite(parsed) ? parsed : text));
  };
}

/** Lista cerrada: el valor elegido, o `null` («por defecto» o «ninguno»), que quita la propiedad. */
export function writeEnum(pointer: string, value: string | null): Change {
  return (draft, saved) => ok(value === null ? clear(draft, saved, pointer) : write(draft, saved, pointer, value));
}

/**
 * Casilla. Al volver al `default` quita la propiedad, salvo que el último guardado la tuviera escrita con ese valor en la
 * misma ruta: entonces la vuelve a escribir (en su sitio).
 */
export function writeBoolean(pointer: string, checked: boolean, defaultValue: boolean): Change {
  return (draft, saved) => {
    if (checked !== defaultValue) return ok(write(draft, saved, pointer, checked));
    const keptInSaved = saved !== null && getIn(saved, pointer) === defaultValue;
    return ok(keptInSaved ? write(draft, saved, pointer, defaultValue) : clear(draft, saved, pointer));
  };
}

/** Salto: el `id` de un nodo, o `null` («ninguno»), que quita la propiedad. */
export function writeTarget(pointer: string, id: string | null): Change {
  return (draft, saved) => ok(id === null ? clear(draft, saved, pointer) : write(draft, saved, pointer, id));
}

/**
 * Parsea un texto JSON y lo aplica en una ruta: comprueba la profundidad del flujo resultante **antes** de serializar y
 * escribe `JSON.parse(JSON.stringify(valor))`, como hace la API (`1e400` queda en `null`).
 *
 * @param draft Borrador.
 * @param saved Último guardado.
 * @param pointer Ruta donde se escribe.
 * @param value Valor ya parseado (sin normalizar).
 * @returns El flujo nuevo o el error de profundidad.
 */
export function applyParsed(draft: FlowDoc, saved: FlowDoc | null, pointer: string, value: unknown): EditResult {
  if (exceedsFlowDepth(setIn(draft, pointer, value))) return fail(DEPTH_ERROR);
  return ok(write(draft, saved, pointer, JSON.parse(JSON.stringify(value)) as unknown));
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * JSON libre (`request.body`, predicados con `all`/`any`): si no se puede parsear, no escribe nada. Vacío en uno
 * opcional quita la propiedad.
 */
export function writeJson(pointer: string, text: string, required: boolean): Change {
  return (draft, saved) => {
    if (text.trim() === '' && !required) return ok(clear(draft, saved, pointer));
    const parsed = parseJson(text);
    return parsed.ok ? applyParsed(draft, saved, pointer, parsed.value) : fail(NOT_JSON_ERROR);
  };
}

/** El modo en que se muestra un valor del flujo. */
export function modeOfValue(value: unknown): ValueMode | 'none' {
  if (value === undefined) return 'none';
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'json';
}

/**
 * Valor en uno de sus modos. `none` quita la propiedad (solo opcionales). Número: solo escribe si el texto es decimal y
 * finito (si no, el campo lo dice y no cambia nada). JSON: como `writeJson`.
 *
 * @param pointer Ruta del valor.
 * @param mode Modo elegido.
 * @param raw Lo escrito (en `boolean`, `'true'` o `'false'`; en `null`, ignorado).
 */
export function writeValue(pointer: string, mode: ValueMode | 'none', raw: string): Change {
  return (draft, saved) => {
    switch (mode) {
      case 'none':
        return ok(clear(draft, saved, pointer));
      case 'string':
        return ok(write(draft, saved, pointer, raw));
      case 'null':
        return ok(write(draft, saved, pointer, null));
      case 'boolean':
        return ok(write(draft, saved, pointer, raw === 'true'));
      case 'number': {
        const parsed = DECIMAL.test(raw) ? Number(raw) : Number.NaN;
        return Number.isFinite(parsed) ? ok(write(draft, saved, pointer, parsed)) : fail('No es un número.');
      }
      case 'json': {
        const parsed = parseJson(raw);
        return parsed.ok ? applyParsed(draft, saved, pointer, parsed.value) : fail(NOT_JSON_ERROR);
      }
    }
  };
}

/** Añade un elemento al final de una lista (la crea si falta). */
export function addItem(listPointer: string, descriptor: FieldDescriptor): Change {
  return (draft, saved) => {
    const current = getIn(draft, listPointer);
    const existing = Array.isArray(current) ? (current as unknown[]) : [];
    const item = descriptor.newItem?.(existing) ?? {};
    return ok(write(draft, saved, `${listPointer}/-`, item));
  };
}

/** Quita un elemento de una lista y poda la lista si queda vacía y es opcional. */
export function removeItem(itemPointer: string): Change {
  return (draft, saved) => ok(clear(draft, saved, itemPointer));
}

/** Cambia el `kind` de un elemento de contenido (D5): entre texto y multimedia sustituye el elemento en su sitio. */
export function setContentKind(itemPointer: string, kind: string): Change {
  return (draft, saved) => {
    const current = getIn(draft, itemPointer);
    const wasText = isRecord(current) && current.kind === 'text';
    if (kind === 'text') return ok(wasText ? draft : write(draft, saved, itemPointer, { kind: 'text', text: '' }));
    if (!wasText && isRecord(current)) return ok(write(draft, saved, `${itemPointer}/kind`, kind));
    return ok(write(draft, saved, itemPointer, { kind, url: '' }));
  };
}

/** Modo de una cabecera. */
export type HeaderMode = 'text' | 'secret';

const headerValue = (mode: HeaderMode, value: string): unknown => (mode === 'secret' ? { secret: value } : value);

/**
 * Cambia el valor de una cabecera existente. «Secreto» escribe `{"secret": NOMBRE}`: solo el nombre. Pasar de secreto a
 * texto escribe `""`.
 *
 * @param headersPointer Puntero de `request.headers`.
 * @param name Nombre de la cabecera.
 */
export function writeHeader(headersPointer: string, name: string, mode: HeaderMode, value: string): Change {
  return (draft, saved) => ok(write(draft, saved, `${headersPointer}${pointerOf([name])}`, headerValue(mode, value)));
}

/** Añade una cabecera al final (crea `headers` si falta). Un nombre repetido o vacío no cambia nada. */
export function addHeader(headersPointer: string, name: string, mode: HeaderMode, value: string): Change {
  return (draft, saved) => {
    if (name === '') return fail('La cabecera necesita un nombre.');
    const current = getIn(draft, headersPointer);
    if (isRecord(current) && Object.hasOwn(current, name)) return fail(DUPLICATE_HEADER_ERROR);
    return ok(write(draft, saved, `${headersPointer}${pointerOf([name])}`, headerValue(mode, value)));
  };
}

/** Renombra una cabecera en su sitio. Un nombre repetido o vacío no cambia nada. */
export function renameHeader(headersPointer: string, from: string, to: string): Change {
  return (draft, saved) => {
    if (to === from) return ok(draft);
    if (to === '') return fail('La cabecera necesita un nombre.');
    const current = getIn(draft, headersPointer);
    if (!isRecord(current) || !Object.hasOwn(current, from)) return ok(draft);
    if (Object.hasOwn(current, to)) return fail(DUPLICATE_HEADER_ERROR);
    const renamed = Object.fromEntries(Object.entries(current).map(([key, value]) => [key === from ? to : key, value]));
    return ok(write(draft, saved, headersPointer, renamed));
  };
}

/** Quita una cabecera y poda `headers` si queda vacío. */
export function removeHeader(headersPointer: string, name: string): Change {
  return (draft, saved) => ok(clear(draft, saved, `${headersPointer}${pointerOf([name])}`));
}
