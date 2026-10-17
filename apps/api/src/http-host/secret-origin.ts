import { startSession, type HttpAttemptResult } from '@franca/engine';

/**
 * Indica si `origin` puede ser el origen de la `url` de un nodo `http`, preguntándoselo al motor y no reimplementando su
 * regla («Destino y longitud de la URL» de `flow-engine`: solo `http:`/`https:`, nombres de dominio, sin IPs ni `localhost`).
 * Ejecuta una sesión con un flujo sonda `GET <origen>/` cuyo host guarda la petición y responde `blocked`; acepta solo si
 * el motor llegó a llamar al host con exactamente `<origen>/`.
 *
 * @param origin El origen escrito en `FRANCA_HTTP_SECRET_ORIGINS`.
 * @returns `true` si el motor lo admite como origen.
 */
export async function isNodeUrlOrigin(origin: string): Promise<boolean> {
  const probe = {
    specVersion: '0.1',
    id: 'sonda-de-origen',
    name: 'Sonda de origen',
    start: 'llamar',
    nodes: [
      { id: 'llamar', type: 'http', request: { method: 'GET', url: `${origin}/` }, next: 'fin', onError: 'fin' },
      { id: 'fin', type: 'end' },
    ],
  };
  const seen: string[] = [];
  const http = async (request: { url: string }): Promise<HttpAttemptResult> => {
    seen.push(request.url);
    return { kind: 'blocked' };
  };
  try {
    await startSession({ flow: probe }, { http });
  } catch {
    return false;
  }
  return seen.length === 1 && seen[0] === `${origin}/`;
}
