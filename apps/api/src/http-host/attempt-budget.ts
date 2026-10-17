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

/**
 * Aborta `controller` cuando han pasado `budgetMs` según `now`, nunca antes. Un `setTimeout` puede vencer hasta un
 * milisegundo antes de su espera (el reloj del bucle de Node va en milisegundos enteros y se guarda al empezar cada
 * vuelta), y el `timeout` de un intento no puede llegar antes de su presupuesto: si vence pronto, espera lo que falta.
 *
 * @param controller El controlador que aborta el intento.
 * @param budgetMs Milisegundos del intento (`attemptBudget`), mayor que 0.
 * @param now Reloj monótono en milisegundos; por defecto `performance.now()`.
 * @returns Una función que cancela la espera.
 */
export function abortAfter(controller: AbortController, budgetMs: number, now: () => number = () => performance.now()): () => void {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout>;
  const arm = (waitMs: number): void => {
    timer = setTimeout(() => {
      const remainingMs = budgetMs - (now() - startedAt);
      if (remainingMs > 0) arm(Math.ceil(remainingMs));
      else controller.abort();
    }, waitMs);
  };
  arm(budgetMs);
  return () => clearTimeout(timer);
}
