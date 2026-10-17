import { MAX_BODY_BYTES } from './limits.js';

/** Bytes máximos del cuerpo de las dos rutas `POST` que reciben datos de una conversación (64 KiB). */
export const MAX_CONVERSATION_BODY_BYTES = 65_536;

/**
 * `POST /conversations` y `POST /conversations/:id/inputs`, como las enruta Express: sin distinguir mayúsculas y con o
 * sin barra final. Si el router las atiende, aquí también.
 */
const CONVERSATION_BODY_ROUTES = /^\/conversations(?:\/[^/]+\/inputs)?\/?$/i;

/**
 * Máximo de bytes del cuerpo de una petición: 64 KiB en las dos rutas `POST` de conversaciones y 1 MiB en el resto. El
 * cuerpo se lee antes del router, así que la ruta se reconoce aquí con la misma regla que el router.
 *
 * @param method Método HTTP en mayúsculas.
 * @param path Ruta de la petición, sin consulta.
 * @returns El máximo en bytes.
 */
export function bodyLimitFor(method: string, path: string): number {
  return method === 'POST' && CONVERSATION_BODY_ROUTES.test(path) ? MAX_CONVERSATION_BODY_BYTES : MAX_BODY_BYTES;
}
