/**
 * Registro mínimo del servidor de la web (D17): el único sitio con `console`. Escribe la plantilla de la ruta
 * (`/api/conversations/[conversationId]/inputs`), nunca la ruta real, el cuerpo, las cabeceras ni nada de una
 * conversación, y solo en 5xx o con la configuración inválida.
 */

/**
 * Registra un error del servidor de la web.
 *
 * @param method Método HTTP.
 * @param template Plantilla de la ruta, con los segmentos dinámicos entre corchetes.
 * @param status Estado que se responde.
 * @param code Código de error que se responde.
 * @param errorClass Nombre de la clase de un error inesperado (nunca su mensaje).
 */
export function logServerError(method: string, template: string, status: number, code: string, errorClass?: string): void {
  console.error(`[web] ${method} ${template} ${status} ${code}${errorClass === undefined ? '' : ` ${errorClass}`}`);
}

/** Registra que `FRANCA_API_URL` no es válida: nombra la variable y nunca repite el valor. */
export function logInvalidApiUrl(): void {
  console.error('[web] FRANCA_API_URL no es válida: cada ruta responde 500 hasta que se arranque la web con una dirección admitida.');
}
