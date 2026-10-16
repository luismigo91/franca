import { MAX_NESTING_DEPTH } from './constants.js';
import type { JsonValue } from './types.js';

/**
 * Forma JSON de un flujo: la misma semántica que `JSON.parse(JSON.stringify(flow))`.
 * Devuelve `undefined` si `stringify` no produce nada (`undefined`, función, símbolo).
 *
 * @param flow Valor recibido del host.
 * @returns Una copia privada, sin referencias al original.
 * @throws Si el valor no se puede serializar (ciclos, `bigint`): es un defecto del host.
 */
export function toJsonForm(flow: unknown): unknown {
  const text = JSON.stringify(flow);
  return text === undefined ? undefined : JSON.parse(text);
}

export type JsonCopy = { ok: true; value: JsonValue } | { ok: false };

const INVALID: JsonCopy = { ok: false };

/**
 * Dice si la estructura de un valor anida más de `limit` niveles de array/objeto (un escalar vale
 * 0, `[[1]]` vale 2). Es iterativa, así que su resultado no depende de la pila disponible; un
 * ciclo sube hasta el límite y cuenta como demasiado profundo. Sigue `Object.keys`, por lo que
 * un array disperso enorme no cuesta, y no ejecuta `toJSON`.
 *
 * @param value Valor a medir.
 * @param limit Profundidad máxima admitida.
 * @returns `true` si supera `limit`.
 */
export function exceedsDepth(value: unknown, limit: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const deepest = new Map<object, number>();
  const stack: [object, number][] = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (depth > limit) return true;
    const seen = deepest.get(node);
    if (seen !== undefined && seen >= depth) continue;
    deepest.set(node, depth);
    for (const key of Object.keys(node)) {
      const child = (node as Record<string, unknown>)[key];
      if (typeof child === 'object' && child !== null) stack.push([child, depth + 1]);
    }
  }
  return false;
}

/**
 * Comprueba de forma estricta que un valor es JSON y devuelve una copia profunda.
 * Rechaza `NaN`, `±Infinity`, `undefined`, funciones, símbolos, `bigint`, objetos que no
 * son planos (prototipo distinto de `Object.prototype` o `null`; arrays con otro prototipo),
 * arrays dispersos y ciclos. `-0` se copia como `0`; las claves `__proto__` se conservan
 * como propiedades propias.
 *
 * @param value Valor a comprobar.
 * @returns La copia, o `{ ok: false }` si no es JSON estricto.
 */
export function cloneJsonStrict(value: unknown): JsonCopy {
  if (exceedsDepth(value, MAX_NESTING_DEPTH)) return INVALID;
  return cloneNode(value, new Set<object>());
}

/**
 * @param value Valor a comprobar.
 * @returns `true` si el valor es JSON estricto (ver `cloneJsonStrict`).
 */
export function checkJsonValue(value: unknown): value is JsonValue {
  return cloneJsonStrict(value).ok;
}

function cloneNode(value: unknown, ancestors: Set<object>): JsonCopy {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value: value === 0 ? 0 : value } : INVALID;
  if (typeof value !== 'object') return INVALID;
  if (ancestors.has(value)) return INVALID;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return cloneArray(value, ancestors);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return INVALID;
    const entries: [string, JsonValue][] = [];
    for (const key of Object.keys(value)) {
      const child = cloneNode((value as Record<string, unknown>)[key], ancestors);
      if (!child.ok) return INVALID;
      entries.push([key, child.value]);
    }
    return { ok: true, value: Object.fromEntries(entries) };
  } finally {
    ancestors.delete(value);
  }
}

function cloneArray(value: unknown[], ancestors: Set<object>): JsonCopy {
  if (Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
  const out: JsonValue[] = [];
  for (let i = 0; i < value.length; i++) {
    if (!(i in value)) return INVALID;
    const child = cloneNode(value[i], ancestors);
    if (!child.ok) return INVALID;
    out.push(child.value);
  }
  return { ok: true, value: out };
}

/**
 * Igualdad estructural estricta entre dos valores JSON, sin coerción. El orden de las
 * claves de un objeto no importa; el de los elementos de un array, sí.
 *
 * @param a Primer valor.
 * @param b Segundo valor.
 * @returns `true` si son estructuralmente iguales.
 */
export function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]!));
  }
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && deepEqual(a[key]!, b[key]!));
}
