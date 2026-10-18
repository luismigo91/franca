import { exceedsFlowDepth } from '@franca/spec';
import { MAX_REQUEST_BODY_BYTES } from '@/config/limits';
import { parseOffset } from '@/server/ids';

/** Fallo de una petición del navegador: el estado y el código de `{"error"}`. */
export interface RequestFailure {
  status: 400 | 413 | 428;
  error: 'invalid_json' | 'invalid_request' | 'invalid_query' | 'payload_too_large' | 'precondition_required';
}

export type Parsed<T> = { ok: true; value: T } | ({ ok: false } & RequestFailure);

const fail = (status: RequestFailure['status'], error: RequestFailure['error']): { ok: false } & RequestFailure => ({ ok: false, status, error });

/**
 * Lee el cuerpo de una mutación como texto UTF-8 estricto, con un tope de 1 MiB, y lo parsea como JSON. Solo lo llaman las
 * mutaciones que llevan cuerpo: un `GET` o un `DELETE` con cuerpo no lo leen. El tope está por debajo de los 10 MB que
 * `proxy.ts` guarda en memoria (más allá trunca en silencio), así que nunca se reenvía un cuerpo truncado.
 *
 * @param request La petición.
 * @returns El texto recibido y su valor JSON, `413 payload_too_large` por encima del tope o `400 invalid_json`.
 */
export async function readJsonText(request: Request): Promise<Parsed<{ text: string; value: unknown }>> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > MAX_REQUEST_BODY_BYTES) return fail(413, 'payload_too_large');
  if (request.body === null) return fail(400, 'invalid_json');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return fail(413, 'payload_too_large');
    }
    chunks.push(value);
  }
  if (size === 0) return fail(400, 'invalid_json');
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { ok: true, value: { text, value: JSON.parse(text) as unknown } };
  } catch {
    return fail(400, 'invalid_json');
  }
}

/**
 * Lee el cuerpo de un `POST` del chat como JSON.
 *
 * @param request La petición.
 * @returns El valor JSON, `413 payload_too_large` por encima del tope o `400 invalid_json`.
 */
export async function readJsonBody(request: Request): Promise<Parsed<unknown>> {
  const parsed = await readJsonText(request);
  return parsed.ok ? { ok: true, value: parsed.value.value } : parsed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Cuerpo de un flujo (crear o guardar): un objeto JSON de hasta 1 MiB. Se reenvía su texto JSON (`JSON.stringify` del valor,
 * el mismo que el del navegador byte a byte); si el valor anida más de 1000 niveles se reenvía el texto recibido tal
 * cual, porque `JSON.stringify` lanzaría `RangeError` con lo que cabe en 1 MiB (la API responde 400 `invalid_flow`).
 *
 * @param request La petición.
 * @returns El texto a reenviar, `413`, `400 invalid_json` o `400 invalid_request` si no es un objeto.
 */
export async function readFlowBody(request: Request): Promise<Parsed<string>> {
  const parsed = await readJsonText(request);
  if (!parsed.ok) return parsed;
  if (!isObject(parsed.value.value)) return fail(400, 'invalid_request');
  return { ok: true, value: exceedsFlowDepth(parsed.value.value) ? parsed.value.text : JSON.stringify(parsed.value.value) };
}

/**
 * Reconstruye el cuerpo de `POST /api/conversations`: `{"flowId"}` o `{"flowId","contactId"}`. No valida el patrón del
 * contacto: lo decide la API y su 400 llega al campo. Un `contactId` que viene lo reenvía tal cual (también `''` o
 * solo espacios), si es texto; el servidor de la web no recorta ni convierte.
 *
 * @param value El JSON del navegador.
 * @returns El cuerpo a reenviar, o `400 invalid_request`.
 */
export function buildCreateBody(value: unknown): Parsed<string> {
  if (!isObject(value) || typeof value.flowId !== 'string') return fail(400, 'invalid_request');
  if (!Object.hasOwn(value, 'contactId')) return { ok: true, value: JSON.stringify({ flowId: value.flowId }) };
  if (typeof value.contactId !== 'string') return fail(400, 'invalid_request');
  return { ok: true, value: JSON.stringify({ flowId: value.flowId, contactId: value.contactId }) };
}

/**
 * Reconstruye el cuerpo de `POST …/inputs`: hace falta la propiedad propia `input`, con cualquier valor, y se
 * reenvía `{"input":…}` (el texto llega exacto, también con espacios).
 */
export function buildInputBody(value: unknown): Parsed<string> {
  if (!isObject(value) || !Object.hasOwn(value, 'input')) return fail(400, 'invalid_request');
  return { ok: true, value: JSON.stringify({ input: value.input }) };
}

const IF_MATCH = /^"[0-9]{1,10}"$/;

/** `If-Match` obligatorio y bien formado (`"<n>"`): si falta, `428`; si está mal formado, `400`. */
export function readIfMatch(request: Request): Parsed<string> {
  const header = request.headers.get('if-match');
  if (header === null) return fail(428, 'precondition_required');
  return IF_MATCH.test(header) ? { ok: true, value: header } : fail(400, 'invalid_request');
}

/** El único parámetro de consulta que admite el navegador. Los desconocidos se ignoran. */
export function readOffset(request: Request): Parsed<number> {
  const offset = parseOffset(new URL(request.url).searchParams.get('offset'));
  return offset === null ? fail(400, 'invalid_query') : { ok: true, value: offset };
}
