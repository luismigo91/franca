/** Fecha y hora en la zona horaria local de quien prueba. Solo se llama desde el navegador, ya con datos cargados. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

/** Coste en dólares tal como lo da la API: `0 USD`, `0.02 USD`. */
export function formatCost(costUsd: number): string {
  return `${costUsd} USD`;
}

/** «1 intento», «2 intentos». */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
