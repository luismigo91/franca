import type { TransportResult } from '@/server/api/transport';
import type { RequestFailure } from '@/server/bff/request';

const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

/** Respuesta JSON de la web: `no-store` siempre (las demás cabeceras de seguridad las pone `proxy.ts`). */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Respuesta sin cuerpo (el 204 de `DELETE`, o el estado de un error sin cuerpo). */
export function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** `{"error": code}` y nunca `message`. */
export function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

/** Responde a un fallo de la petición del navegador. */
export function failureResponse(failure: RequestFailure): Response {
  return errorResponse(failure.status, failure.error);
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseObject(body: Uint8Array | null): Obj | null {
  if (body === null) return null;
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** Quita `message` de un evento `error`: ni el inspector del navegador ni la carga RSC lo ven jamás. */
function stripMessage(event: unknown): unknown {
  if (!isObject(event) || event.type !== 'error') return event;
  const clean = { ...event };
  delete clean.message;
  return clean;
}

/** Quita el `message` de todo `error` de `events[]` (avance) y de `items[].event` (transcripción). */
function sanitizeEvents(body: Obj): Obj {
  const clean: Obj = { ...body };
  if (Array.isArray(body.events)) clean.events = body.events.map(stripMessage);
  if (Array.isArray(body.items)) {
    clean.items = body.items.map((item) => (isObject(item) && 'event' in item ? { ...item, event: stripMessage(item.event) } : item));
  }
  return clean;
}

/** De `getFlowVersion` solo pasa `{flowId, version, name}`: la definición del flujo pesa y no se usa. */
function reduceVersion(body: Obj): Obj | null {
  if (typeof body.flowId !== 'string' || typeof body.version !== 'number' || typeof body.name !== 'string') return null;
  return { flowId: body.flowId, version: body.version, name: body.name };
}

/** Qué operación respondió: cambia el 204 y el saneado. */
export type ResponseKind = 'json' | 'flowVersion' | 'delete';

/**
 * Convierte lo que devolvió el transporte en la respuesta de la web (tabla de D8). El `message` de la API no sale
 * nunca del servidor, y un error sin cuerpo legible llega con el mismo estado y sin cuerpo.
 *
 * @param result Resultado del transporte.
 * @param kind La operación.
 */
export function toWebResponse(result: TransportResult, kind: ResponseKind): Response {
  if (result.kind === 'unreachable') return errorResponse(502, 'api_unreachable');
  if (result.kind === 'invalid') return errorResponse(502, 'invalid_api_response');
  const { status, body } = result;
  if (status < 200 || (status >= 300 && status < 400)) return errorResponse(502, 'invalid_api_response');
  if (status < 300) {
    if (status === 204 && kind === 'delete') return emptyResponse(204);
    const parsed = parseObject(body);
    if (parsed === null) return errorResponse(502, 'invalid_api_response');
    if (kind === 'flowVersion') {
      const reduced = reduceVersion(parsed);
      return reduced === null ? errorResponse(502, 'invalid_api_response') : jsonResponse(status, reduced);
    }
    return jsonResponse(status, sanitizeEvents(parsed));
  }
  const parsed = parseObject(body);
  if (parsed === null || typeof parsed.error !== 'string' || !ERROR_CODE.test(parsed.error)) return emptyResponse(status);
  const payload: Obj = { error: parsed.error };
  if (status === 412 && typeof parsed.currentRevision === 'number' && Number.isInteger(parsed.currentRevision)) payload.currentRevision = parsed.currentRevision;
  return jsonResponse(status, payload);
}
