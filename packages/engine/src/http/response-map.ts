import type { HttpNode } from '@franca/spec';
import { MAX_MAPPED_VALUE_DEPTH, MAX_RENDERED_LENGTH } from '../constants.js';
import { isAsciiDigit, hasUnstorable } from '../input/parsers/chars.js';
import { cloneJsonWithinDepth, exceedsDepth } from '../json.js';
import { textOf } from '../template.js';
import type { JsonValue, VariableValue } from '../types.js';

type MapEntry = NonNullable<HttpNode['responseMap']>[number];

/** @returns `true` si todo `~` del puntero va seguido de `0` o de `1`. */
export function checkPointerEscapes(pointer: string): boolean {
  for (let i = 0; i < pointer.length; i++) {
    if (pointer[i] === '~' && pointer[i + 1] !== '0' && pointer[i + 1] !== '1') return false;
  }
  return true;
}

/**
 * Tokens de un puntero RFC 6901 ya comprobado: `""` es el documento entero; si no, se parte por `/`
 * y cada token se decodifica en una pasada (`~1` → `/`, `~0` → `~`, de modo que `~01` es `~1`).
 */
export function decodePointer(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => {
      let out = '';
      for (let i = 0; i < token.length; i++) {
        if (token[i] === '~') out += token[++i] === '0' ? '~' : '/';
        else out += token[i];
      }
      return out;
    });
}

/** Índice de array de RFC 6901: `0` o dígitos sin cero inicial. Sin `Number()` sobre texto arbitrario. */
function arrayIndex(token: string): number | undefined {
  if (token.length === 0 || (token.length > 1 && token[0] === '0')) return undefined;
  for (const c of token) if (!isAsciiDigit(c)) return undefined;
  return Number(token);
}

/**
 * Sigue los tokens por el documento, uno cada vez y sin recursión. En un array solo vale un índice
 * decimal sin ceros a la izquierda y dentro de rango (`-` no encuentra nada); en un objeto, solo
 * propiedades propias (`__proto__` del cuerpo se encuentra, `constructor` no); en un escalar, nada.
 *
 * @returns El valor, o `undefined` si el puntero no encuentra nada.
 */
export function resolvePointer(doc: unknown, tokens: readonly string[]): unknown {
  let current = doc;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = arrayIndex(token);
      if (index === undefined || index >= current.length) return undefined;
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      if (!Object.hasOwn(current, token)) return undefined;
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Barrido iterativo: U+0000 o un sustituto suelto en un string o en una clave. */
function hasUnstorableText(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === 'string') {
      if (hasUnstorable(item)) return true;
    } else if (Array.isArray(item)) {
      for (const child of item) stack.push(child);
    } else if (typeof item === 'object' && item !== null) {
      for (const key of Object.keys(item)) {
        if (hasUnstorable(key)) return true;
        stack.push((item as Record<string, unknown>)[key]);
      }
    }
  }
  return false;
}

/**
 * Comprueba que un valor encontrado se puede guardar y renderizar: como mucho
 * `MAX_MAPPED_VALUE_DEPTH` niveles (medido de forma iterativa **antes** de copiar), números
 * finitos, sin U+0000 ni sustitutos sueltos en strings ni claves, y forma textual de como mucho
 * `MAX_RENDERED_LENGTH`.
 *
 * @returns Una copia independiente, o `undefined` si no se puede guardar.
 */
export function checkMappedValue(value: unknown): VariableValue | undefined {
  if (exceedsDepth(value, MAX_MAPPED_VALUE_DEPTH)) return undefined;
  const copy = cloneJsonWithinDepth(value);
  if (!copy.ok || copy.value === null) return undefined;
  if (hasUnstorableText(copy.value)) return undefined;
  if (textOf(copy.value).length > MAX_RENDERED_LENGTH) return undefined;
  return copy.value;
}

export type MapResult = { ok: true; assignments: [variable: string, value: JsonValue][] } | { ok: false };

/**
 * Aplica `responseMap` a un cuerpo: parsea el JSON y resuelve **todas** las entradas, en orden y
 * sin asignar nada; si alguna no se puede guardar, falla todo. Un puntero que no encuentra nada, o
 * encuentra `null`, deja la variable sin valor.
 *
 * @param body Cuerpo de la respuesta (su tamaño se comprobó antes, nunca después de parsear).
 * @param entries `responseMap` del nodo, con los escapes de los punteros ya comprobados.
 * @returns Las asignaciones a hacer en orden, o `{ ok: false }` (`invalid_response`).
 */
export function mapResponse(body: string, entries: readonly MapEntry[]): MapResult {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return { ok: false };
  }
  const assignments: [string, JsonValue][] = [];
  for (const entry of entries) {
    const found = resolvePointer(doc, decodePointer(entry.pointer));
    if (found === undefined || found === null) {
      assignments.push([entry.variable, null]);
      continue;
    }
    const value = checkMappedValue(found);
    if (value === undefined) return { ok: false };
    assignments.push([entry.variable, value]);
  }
  return { ok: true, assignments };
}
