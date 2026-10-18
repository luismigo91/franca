/** Un flujo (o cualquier objeto JSON) tal como lo devolvió `JSON.parse`: la fuente de verdad del editor (D4). */
export type FlowDoc = Record<string, unknown>;

/** Tipo de un contenedor JSON que `setIn` crea cuando falta un paso de la ruta. */
export type ContainerKind = 'list' | 'object';

/** Resultado de una edición: el flujo nuevo o el motivo por el que no se aplicó (el flujo no cambia). */
export type EditResult = { ok: true; flow: FlowDoc } | { ok: false; error: string };

/** Una edición pura del borrador. `saved` es el último guardado (o `null` antes de abrir). */
export type Change = (draft: FlowDoc, saved: FlowDoc | null) => EditResult;

/** Opciones de escritura de `setIn`. */
export interface WriteOptions {
  /** Tipo del contenedor que hay que crear en esa ruta (lo da el descriptor, D5). Sin ella: `[]` si el siguiente segmento es `-`. */
  kindAt?: (path: readonly string[]) => ContainerKind | undefined;
  /** Último guardado: una clave nueva se inserta en el sitio que tenía allí (D5, «Último guardado»). */
  saved?: unknown;
}

/** Indica si un valor es un objeto JSON que no es una lista. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Escapa un segmento de JSON Pointer (RFC 6901): `~` como `~0` y después `/` como `~1`.
 *
 * @param segment Un nombre de clave o un índice.
 */
export function escapeSegment(segment: string | number): string {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * La única función que arma un JSON Pointer: escapa cada segmento (RFC 6901), como los `path` de `validateFlow`.
 *
 * @param segments Claves e índices, de la raíz hacia dentro.
 * @returns `''` para la raíz, o `/a/b`.
 */
export function pointerOf(segments: readonly (string | number)[]): string {
  return segments.map((segment) => `/${escapeSegment(segment)}`).join('');
}

/**
 * Parte un JSON Pointer en segmentos y decodifica `~1` y después `~0`.
 *
 * @param pointer `''` o un puntero que empieza por `/`.
 * @throws {TypeError} Si no empieza por `/`.
 */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new TypeError(`puntero JSON no válido: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function arrayIndex(segment: string): number | null {
  return /^(0|[1-9][0-9]*)$/.test(segment) ? Number(segment) : null;
}

/**
 * Lee un valor por su puntero sin lanzar nunca: devuelve `undefined` en cuanto un paso no es un objeto ni una lista
 * (`null`, un número, un texto) o la clave no es propia (`constructor`).
 *
 * @param root Raíz.
 * @param pointer Puntero RFC 6901.
 */
export function getIn(root: unknown, pointer: string): unknown {
  let current: unknown = root;
  for (const segment of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment);
      if (index === null || index >= current.length) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      if (!Object.hasOwn(current, segment)) return undefined;
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Inserta una clave nueva en el sitio que tenía en el último guardado, o al final. */
function insertEntry(entries: [string, unknown][], key: string, value: unknown, savedParent: unknown): [string, unknown][] {
  if (isRecord(savedParent) && Object.hasOwn(savedParent, key)) {
    const order = Object.keys(savedParent);
    const at = order.indexOf(key);
    const positionOf = (name: string) => entries.findIndex(([entryKey]) => entryKey === name);
    for (let before = at - 1; before >= 0; before--) {
      const found = positionOf(order[before]!);
      if (found !== -1) return [...entries.slice(0, found + 1), [key, value], ...entries.slice(found + 1)];
    }
    for (let after = at + 1; after < order.length; after++) {
      const found = positionOf(order[after]!);
      if (found !== -1) return [...entries.slice(0, found), [key, value], ...entries.slice(found)];
    }
  }
  return [...entries, [key, value]];
}

function emptyContainer(path: readonly string[], nextSegment: string | undefined, options: WriteOptions): unknown {
  const kind = options.kindAt?.(path) ?? (nextSegment === '-' ? 'list' : 'object');
  return kind === 'list' ? [] : {};
}

function writeAt(node: unknown, segments: readonly string[], depth: number, value: unknown, options: WriteOptions): unknown {
  const segment = segments[depth]!;
  const last = depth === segments.length - 1;
  const path = segments.slice(0, depth + 1);
  if (Array.isArray(node)) {
    const index = segment === '-' ? node.length : arrayIndex(segment);
    if (index === null || index > node.length) throw new TypeError(`índice fuera de la lista: ${segment}`);
    const exists = index < node.length;
    const next = last ? value : writeAt(exists ? node[index] : emptyContainer(path, segments[depth + 1], options), segments, depth + 1, value, options);
    const copy = node.slice();
    copy[index] = next;
    return copy;
  }
  if (isRecord(node)) {
    const exists = Object.hasOwn(node, segment);
    let next: unknown;
    if (last) next = value;
    else if (exists) next = writeAt(node[segment], segments, depth + 1, value, options);
    else next = writeAt(emptyContainer(path, segments[depth + 1], options), segments, depth + 1, value, options);
    const entries = Object.entries(node);
    if (exists) return Object.fromEntries(entries.map(([key, current]) => (key === segment ? [key, next] : [key, current])));
    return Object.fromEntries(insertEntry(entries, segment, next, options.saved === undefined ? undefined : getIn(options.saved, pointerOf(segments.slice(0, depth)))));
  }
  throw new TypeError(`no se puede escribir dentro de un valor que no es un objeto ni una lista: /${segments.slice(0, depth).join('/')}`);
}

/**
 * Escribe un valor en una ruta, copiando solo lo que cambia. Una clave que existe se sustituye en su sitio; una nueva
 * va al final (o donde la tenía el último guardado). Un paso intermedio **ausente** se crea (su tipo lo da `kindAt`);
 * uno que existe y no es contenedor es un error de programación. Nunca hace `obj[clave] = valor` (`__proto__` es una
 * clave más).
 *
 * @param root Raíz (un contenedor).
 * @param pointer Puntero RFC 6901 no vacío.
 * @param value Valor a escribir.
 * @param options Tipo de los contenedores nuevos y último guardado.
 * @returns La raíz nueva.
 * @throws {TypeError} Si un paso existe y no es un contenedor, o el índice de una lista no vale.
 */
export function setIn(root: FlowDoc, pointer: string, value: unknown, options: WriteOptions = {}): FlowDoc {
  const segments = parsePointer(pointer);
  if (segments.length === 0) throw new TypeError('no se puede sustituir la raíz');
  return writeAt(root, segments, 0, value, options) as FlowDoc;
}

function removeAt(node: unknown, segments: readonly string[], depth: number): unknown {
  const segment = segments[depth]!;
  const last = depth === segments.length - 1;
  if (Array.isArray(node)) {
    const index = arrayIndex(segment);
    if (index === null || index >= node.length) return node;
    if (last) return node.filter((_, position) => position !== index);
    const child = removeAt(node[index], segments, depth + 1);
    if (child === node[index]) return node;
    const copy = node.slice();
    copy[index] = child;
    return copy;
  }
  if (isRecord(node)) {
    if (!Object.hasOwn(node, segment)) return node;
    if (last) return Object.fromEntries(Object.entries(node).filter(([key]) => key !== segment));
    const child = removeAt(node[segment], segments, depth + 1);
    if (child === node[segment]) return node;
    return Object.fromEntries(Object.entries(node).map(([key, current]) => (key === segment ? [key, child] : [key, current])));
  }
  return node;
}

/**
 * Quita el valor de una ruta. Si la ruta no existe (un paso ausente o que no es un contenedor) no hace nada y devuelve
 * la misma raíz.
 *
 * @param root Raíz.
 * @param pointer Puntero RFC 6901.
 * @returns La raíz nueva, o la misma si no había nada que quitar.
 */
export function removeIn(root: FlowDoc, pointer: string): FlowDoc {
  const segments = parsePointer(pointer);
  if (segments.length === 0) return root;
  return removeAt(root, segments, 0) as FlowDoc;
}
