/**
 * Milisegundos que le quedan a un intento: el `timeoutMs` del nodo, recortado por lo que queda del plazo del avance.
 * Un intento empezado dentro del plazo termina, como mucho, al acabar el plazo.
 *
 * @param timeoutMs El `timeoutMs` del intento.
 * @param remainingMs Lo que queda del plazo del avance (`deadlineMs - now()`); puede ser 0 o negativo.
 * @returns `min(timeoutMs, remainingMs)`; `<= 0` significa que el plazo ya pasó.
 */
export function attemptBudget(timeoutMs: number, remainingMs: number): number {
  return Math.min(timeoutMs, remainingMs);
}
