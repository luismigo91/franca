/** Elementos por página de los listados (D3). */
export const LIST_PAGE_SIZE = 20;
/** Entradas por página al leer una transcripción (D12). */
export const TRANSCRIPT_PAGE_SIZE = 100;

/** Plazo del servidor de la web para un avance de conversación (creación o entrada): los 150 s de un `llm` con margen. */
export const ADVANCE_TIMEOUT_MS = 180_000;
/** Plazo del servidor de la web para cualquier otra operación. */
export const READ_TIMEOUT_MS = 15_000;
/** Plazo del navegador para un avance: mayor que el del servidor, para que conteste antes la web. */
export const BROWSER_ADVANCE_TIMEOUT_MS = 200_000;
/** Plazo del navegador para una lectura. */
export const BROWSER_READ_TIMEOUT_MS = 30_000;

/** Cuerpo máximo que lee la web de un `POST` (mayor que los 64 KiB de la API, menor que los 10 MB del búfer de `proxy.ts`). */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
/** Respuesta máxima que acepta la web de la API. */
export const MAX_API_RESPONSE_BYTES = 32 * 1024 * 1024;

/** Veces que se vuelve a empezar la lectura de una transcripción si su `total` cambia entre páginas. */
export const TRANSCRIPT_MAX_RESTARTS = 3;
