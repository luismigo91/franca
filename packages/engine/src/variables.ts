import type { Variable } from '@franca/spec';
import { cloneJsonStrict } from './json.js';
import type { JsonValue, VariableValue } from './types.js';

type Scope = 'session' | 'contact';

/**
 * Valores de las variables de una operación. Se apoya en `Map`, nunca en propiedades de objeto:
 * `constructor`, `toString` o `__proto__` son nombres normales. El almacén es propio de la
 * operación y nada externo se muta.
 */
export class VariableStore {
  private readonly values = new Map<string, VariableValue>();
  private readonly scopes = new Map<string, Scope>();

  /** @param declared Variables del flujo (forma JSON), en orden de declaración. */
  constructor(declared: readonly Variable[] | undefined) {
    for (const variable of declared ?? []) {
      if (this.scopes.has(variable.name)) continue;
      this.scopes.set(variable.name, variable.scope === 'contact' ? 'contact' : 'session');
    }
  }

  /** @returns `true` si el flujo declara la variable. */
  isDeclared(name: string): boolean {
    return this.scopes.has(name);
  }

  /** @returns El valor actual, o `undefined` si no tiene. */
  get(name: string): VariableValue | undefined {
    return this.values.get(name);
  }

  /** Asigna un valor; `null` deja la variable sin valor. */
  set(name: string, value: JsonValue): void {
    if (value === null) this.values.delete(name);
    else this.values.set(name, value);
  }

  /** @returns Variables de sesión con valor, en orden de declaración. */
  sessionVariables(): Record<string, VariableValue> {
    const entries: [string, VariableValue][] = [];
    for (const [name, scope] of this.scopes) {
      const value = this.values.get(name);
      if (scope === 'session' && value !== undefined) entries.push([name, value]);
    }
    return Object.fromEntries(entries);
  }

  /** @returns Todas las variables de contacto declaradas (`null` sin valor), en orden de declaración. */
  contactVariables(): Record<string, VariableValue | null> {
    const entries: [string, VariableValue | null][] = [];
    for (const [name, scope] of this.scopes) {
      if (scope === 'contact') entries.push([name, this.values.get(name) ?? null]);
    }
    return Object.fromEntries(entries);
  }
}

/**
 * Crea el almacén inicial: cada variable toma su `default` (copia independiente) y, si es de
 * contacto y el host inyectó un valor no `null`, gana ese. Las claves ajenas se ignoran.
 *
 * @param declared Variables del flujo (forma JSON).
 * @param contact Valores de contacto ya comprobados.
 * @returns El almacén listo para ejecutar.
 */
export function createVariableStore(
  declared: readonly Variable[] | undefined,
  contact: ReadonlyMap<string, JsonValue>,
): VariableStore {
  const store = new VariableStore(declared);
  const seen = new Set<string>();
  for (const variable of declared ?? []) {
    if (seen.has(variable.name)) continue;
    seen.add(variable.name);
    const injected = variable.scope === 'contact' ? contact.get(variable.name) : undefined;
    if (injected !== undefined && injected !== null) {
      store.set(variable.name, injected);
      continue;
    }
    const copy = cloneJsonStrict(variable.default ?? null);
    store.set(variable.name, copy.ok ? copy.value : null);
  }
  return store;
}
