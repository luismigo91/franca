/**
 * El texto JSON de un flujo: un `JSON.stringify` sin casos nulos. El borrador nunca pasa de 1000 niveles ni tiene valores
 * que no hagan ida y vuelta por JSON (D5), así que no lanza.
 *
 * @param flow Un flujo.
 */
export function flowText(flow: unknown): string {
  return JSON.stringify(flow);
}

/**
 * Bytes UTF-8 de un texto (`ñ` cuenta dos).
 *
 * @param text El texto.
 */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
