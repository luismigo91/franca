import type { Flow } from '@franca/spec';
import type { JsonValue } from '@franca/engine';

/** Todas las variables de contacto de una versión: valor o `null` sin valor. Es la forma de `SessionState.contact`. */
export type ContactView = Record<string, JsonValue | null>;

/**
 * La vista de contacto con la que empieza una conversación, la misma que el motor construye en `createVariableStore`
 * y publica en `state.contact`: para cada variable `scope: contact` (la primera declaración de cada nombre, en orden), el
 * valor guardado no nulo o, si no hay, su `default`, o `null`. Replica lógica del motor; la fija un test de paridad.
 *
 * @param flow La versión que se ejecuta.
 * @param stored Valores guardados del contacto, por nombre.
 * @returns La vista inicial.
 */
export function initialContactView(flow: Pick<Flow, 'variables'>, stored: ReadonlyMap<string, JsonValue>): ContactView {
  const entries: [string, JsonValue | null][] = [];
  const seen = new Set<string>();
  for (const variable of flow.variables ?? []) {
    if (seen.has(variable.name)) continue;
    seen.add(variable.name);
    if (variable.scope !== 'contact') continue;
    const saved = stored.get(variable.name);
    // `Object.fromEntries` define propiedades propias: un nombre como `__proto__` no toca el prototipo.
    entries.push([variable.name, saved !== undefined && saved !== null ? saved : ((variable.default as JsonValue | undefined) ?? null)]);
  }
  return Object.fromEntries(entries);
}

export interface ContactChanges {
  /** Valores que se guardan (`[nombre, valor]`), en el orden del estado. */
  upserts: [string, JsonValue][];
  /** Nombres cuyo guardado se borra («sin valor»). */
  deletes: string[];
}

/**
 * Igualdad estructural de dos valores JSON, sin importar el orden de las claves. Iterativa: aguanta los 1000 niveles que
 * admite un valor de contacto sin agotar la pila.
 */
export function jsonEqual(left: JsonValue | null, right: JsonValue | null): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [a, b] = pair;
    if (a === b) continue;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      a.forEach((item, index) => pending.push([item, b[index]]));
      continue;
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return false;
      pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]]);
    }
  }
  return true;
}

/**
 * Qué cambió un avance en el contacto: cada nombre de `after` cuyo valor difiere del de `before`. Un valor nuevo se
 * guarda; «sin valor» (`null`) borra el guardado; lo no cambiado no se escribe (dos conversaciones del mismo contacto no
 * se pisan) y un `default` igual al inicial tampoco. No se comprueba el tipo.
 *
 * @param before La vista al empezar el avance.
 * @param after `state.contact` tras el avance.
 * @returns Los cambios.
 */
export function diffContact(before: ContactView, after: ContactView): ContactChanges {
  const changes: ContactChanges = { upserts: [], deletes: [] };
  for (const name of Object.keys(after)) {
    const next = after[name] ?? null;
    const previous = Object.hasOwn(before, name) ? (before[name] ?? null) : null;
    if (jsonEqual(previous, next)) continue;
    if (next === null) changes.deletes.push(name);
    else changes.upserts.push([name, next]);
  }
  return changes;
}
