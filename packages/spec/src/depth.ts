/** Niveles máximos de arrays y objetos anidados que admite un flujo (paridad con `MAX_NESTING_DEPTH` del motor). */
export const MAX_FLOW_DEPTH = 1000;

/**
 * Indica si un valor anida arrays y objetos por encima de un límite, sin recursión: no depende de la pila disponible.
 * Un escalar vale 0, `[[1]]` vale 2; recorre `Object.keys` (un array disperso enorme cuesta lo que tiene de elementos
 * definidos) y un ciclo cuenta como demasiado profundo. Es la misma medida que `exceedsDepth` del motor.
 *
 * @param value Valor a medir (lo que da `JSON.parse` o cualquier objeto en memoria).
 * @param limit Niveles admitidos; por defecto `MAX_FLOW_DEPTH`.
 * @returns `true` si algún camino supera `limit` niveles.
 */
export function exceedsFlowDepth(value: unknown, limit: number = MAX_FLOW_DEPTH): boolean {
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
