import { MAX_INPUT_LENGTH, MAX_MAPPED_VALUE_DEPTH } from '../constants.js';
import { hasUnstorable } from '../input/parsers/chars.js';
import { textOf } from '../template.js';
import type { JsonValue } from '../types.js';

export type JsonCopy = { ok: true; value: JsonValue } | { ok: false };

const REJECTED: JsonCopy = { ok: false };

/** Forma textual máxima de un slot `json`: la de la respuesta de un `input`. */
const MAX_JSON_SLOT_LENGTH = MAX_INPUT_LENGTH;

/** Un array u objeto a medio copiar. */
interface Frame {
  readonly source: object;
  /** Array: `null`; objeto: sus claves, leídas una vez. */
  readonly keys: string[] | null;
  readonly length: number;
  index: number;
  readonly items: JsonValue[];
  readonly entries: [string, JsonValue][];
  /** Clave del hijo que se está copiando (objetos). */
  pendingKey: string;
}

/**
 * Copia un valor `json` que viene de un objeto vivo del host, en **una** pasada iterativa (sin
 * recursión) que lee cada propiedad una vez: lo copiado es exactamente lo leído.
 *
 * Deja de copiar, sin seguir leyendo, en cuanto supera 100 niveles o una cota inferior de la forma
 * textual de 4096 unidades. La cota suma lo que ya se vio (un string de **primer nivel** solo su
 * longitud; dentro de un array u objeto, longitud + 2 por string y longitud + 3 por clave, la
 * serialización de cada número, 4/5/4 por `true`/`false`/`null`, 2 por contenedor y 1 por separador)
 * y cada nodo visitado suma al menos 1: el trabajo queda acotado por ~4097 nodos aunque el host pase
 * un grafo con referencias compartidas o un ciclo. La longitud de un string o de una clave se suma
 * **antes** de buscar en él U+0000 o sustitutos, así que nunca se recorre un texto que ya no cabe.
 *
 * Rechaza (sin copiar) números no finitos, prototipos que no son `Object.prototype` o `null`,
 * arrays con otro prototipo o con huecos, `undefined`, funciones, símbolos, `bigint`, y U+0000 o
 * sustitutos sueltos en strings y claves. `-0` se copia como 0 y las claves `__proto__` se
 * conservan como propiedades propias.
 *
 * @param value Valor del host (el llamador descarta `null` antes).
 * @returns La copia, o `{ ok: false }` si no cabe o no es JSON.
 * @throws Lo que lance una lectura del host (getter, `Proxy`): el llamador lo trata como defecto del host.
 */
export function copyJsonValue(value: unknown): JsonCopy {
  let size = 0;
  /** Suma a la cota; `false` si ya no puede caber. */
  const add = (units: number): boolean => {
    size += units;
    return size <= MAX_JSON_SLOT_LENGTH;
  };
  /** Un string o una clave: primero su longitud, luego (solo si cabe) sus caracteres. */
  const acceptText = (text: string, overhead: number): boolean => add(text.length + overhead) && !hasUnstorable(text);

  /** @returns La copia de un escalar, o `undefined` si se rechaza. */
  const scalar = (item: unknown, topLevel: boolean): JsonValue | undefined => {
    if (typeof item === 'string') return acceptText(item, topLevel ? 0 : 2) ? item : undefined;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) return undefined;
      const normalized = item === 0 ? 0 : item;
      return add(String(normalized).length) ? normalized : undefined;
    }
    if (typeof item === 'boolean') return add(item ? 4 : 5) ? item : undefined;
    if (item === null) return add(4) ? null : undefined;
    return undefined;
  };

  /** @returns El marco de un array u objeto, o `undefined` si se rechaza. */
  const open = (item: object, depth: number): Frame | undefined => {
    if (depth > MAX_MAPPED_VALUE_DEPTH || !add(2)) return undefined;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype) return undefined;
      const length = item.length;
      // Cada elemento mide al menos 1: un array más largo que la cota no cabe, y no se recorre.
      if (length > MAX_JSON_SLOT_LENGTH) return undefined;
      return { source: item, keys: null, length, index: 0, items: [], entries: [], pendingKey: '' };
    }
    const proto = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== null) return undefined;
    const keys = Object.keys(item);
    return { source: item, keys, length: keys.length, index: 0, items: [], entries: [], pendingKey: '' };
  };

  if (typeof value !== 'object' || value === null) {
    const copy = scalar(value, true);
    return copy === undefined ? REJECTED : { ok: true, value: copy };
  }
  const root = open(value, 1);
  if (root === undefined) return REJECTED;

  const stack: Frame[] = [root];
  let result: JsonValue = null;
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    let child: JsonValue | undefined;
    if (frame.index >= frame.length) {
      stack.pop();
      child = frame.keys === null ? frame.items : Object.fromEntries(frame.entries);
      if (stack.length === 0) result = child;
    } else {
      // Un separador por elemento tras el primero.
      if (frame.index > 0 && !add(1)) return REJECTED;
      let property: string | number = frame.index;
      if (frame.keys === null) {
        if (!Object.hasOwn(frame.source, frame.index)) return REJECTED;
      } else {
        property = frame.keys[frame.index]!;
        if (!acceptText(property, 3)) return REJECTED;
        frame.pendingKey = property;
      }
      const read: unknown = (frame.source as Record<string | number, unknown>)[property];
      frame.index++;
      if (typeof read === 'object' && read !== null) {
        const opened = open(read, stack.length + 1);
        if (opened === undefined) return REJECTED;
        stack.push(opened);
        continue;
      }
      child = scalar(read, false);
      if (child === undefined) return REJECTED;
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) continue;
    if (parent.keys === null) parent.items.push(child);
    else parent.entries.push([parent.pendingKey, child]);
  }
  return textOf(result as Exclude<JsonValue, null>).length <= MAX_JSON_SLOT_LENGTH ? { ok: true, value: result } : REJECTED;
}
