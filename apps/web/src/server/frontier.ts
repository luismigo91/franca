import { isLocalHost } from '@/server/config/local-host.cjs';
import { isConversationId } from '@/server/ids';

/**
 * Cabeceras de seguridad de toda respuesta de la web (D2, D24). Nunca `Access-Control-Allow-*`: la web no tiene CORS.
 * `no-store` no va en `/_next/static/`: sus ficheros llevan hash y no tienen datos.
 */
export function securityHeaders(pathname: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
  };
  if (pathname.startsWith('/_next/static/')) delete headers['Cache-Control'];
  return headers;
}

/** Lo único que lee la frontera de una petición: método, cabeceras y ruta. Nunca `request.url` ni `nextUrl.host`. */
export interface FrontierRequest {
  method: string;
  headers: Pick<Headers, 'get'>;
  pathname: string;
}

export type FrontierDecision =
  | { allowed: true; headers: Record<string, string> }
  | { allowed: false; status: 403 | 404; body: string | null; headers: Record<string, string> };

const SAFE_METHODS = new Set(['GET', 'HEAD']);
const CONVERSATION_ROUTE = '/api/conversations/';

function deny(status: 403 | 404, body: string | null, pathname: string): FrontierDecision {
  const headers = securityHeaders(pathname);
  if (body !== null) headers['Content-Type'] = 'application/json; charset=utf-8';
  return { allowed: false, status, body, headers };
}

/** Indica si el segundo segmento de `/api/conversations/<id>/…`, decodificado, es un UUID (un `%` mal formado no lo es). */
function hasValidConversationSegment(pathname: string): boolean {
  const segment = pathname.slice(CONVERSATION_ROUTE.length).split('/')[0] ?? '';
  try {
    return isConversationId(decodeURIComponent(segment));
  } catch {
    return false;
  }
}

/**
 * La frontera local de la web (D2): decide sobre la cabecera `host` **en bruto**, nunca sobre `x-forwarded-*`, que Next
 * rellena con `??=` y respeta si la manda el cliente.
 *
 * 1. `Host` local (`localhost`, `127.0.0.1` o `[::1]`, con puerto opcional) o 403 sin cuerpo.
 * 2. En todo método que no sea `GET` ni `HEAD`, `Origin` igual a `http://` y el `Host` ya validado, o 403 sin cuerpo.
 * 3. Una ruta de conversación cuyo id no es un UUID en minúsculas: 404 `conversation_not_found`.
 *
 * @param request Método, cabeceras y ruta.
 * @returns Permitir, o denegar con su estado, cuerpo y cabeceras. En ambos casos van las cabeceras de seguridad.
 */
export function checkFrontier(request: FrontierRequest): FrontierDecision {
  const host = request.headers.get('host');
  if (host === null || !isLocalHost(host)) return deny(403, null, request.pathname);
  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    const origin = request.headers.get('origin');
    if (origin === null || origin !== `http://${host.toLowerCase()}`) return deny(403, null, request.pathname);
  }
  if (request.pathname.startsWith(CONVERSATION_ROUTE) && !hasValidConversationSegment(request.pathname)) {
    return deny(404, JSON.stringify({ error: 'conversation_not_found' }), request.pathname);
  }
  return { allowed: true, headers: securityHeaders(request.pathname) };
}
