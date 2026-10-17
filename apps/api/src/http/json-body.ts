import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { raw, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ApiException, payloadTooLarge } from './api-error.js';
import { bodyLimitFor, MAX_CONVERSATION_BODY_BYTES } from './body-limits.js';
import { MAX_BODY_BYTES } from './limits.js';

/** El cuerpo ya decodificado: ausente, o el valor que dio `JSON.parse`. */
type ParsedBody = { present: false } | { present: true; value: unknown };

const BODIES = new WeakMap<Request, ParsedBody>();

/**
 * Indica si un `Content-Type` es `application/json` con, como mucho, el parámetro `charset=utf-8`
 * (sin distinguir mayúsculas, con o sin comillas).
 *
 * @param header Valor de la cabecera; `undefined` si falta.
 * @returns `true` si se admite.
 */
export function isAcceptedContentType(header: string | undefined): boolean {
  if (header === undefined) return false;
  const [type, ...params] = header.split(';');
  if (type!.trim().toLowerCase() !== 'application/json') return false;
  if (params.length === 0) return true;
  if (params.length > 1) return false;
  const match = /^\s*charset\s*=\s*("?)utf-8\1\s*$/i.exec(params[0]!);
  return match !== null;
}

/**
 * Decodifica bytes como UTF-8 estricto: un byte inválido es un error, y un BOM se conserva (así `JSON.parse` lo
 * rechaza en vez de aceptarlo en silencio).
 *
 * @param bytes Cuerpo de la petición.
 * @returns El texto, o `undefined` si no es UTF-8 válido.
 */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** `Content-Encoding` ausente o `identity` (sin comprimir). */
function isUncompressed(encoding: string | undefined): boolean {
  return encoding === undefined || encoding.trim().toLowerCase() === 'identity';
}

/** Errores de body-parser a errores del contrato; los demás pasan tal cual (acabarán en 500). */
function mapBodyParserError(error: unknown, limitBytes: number): unknown {
  const type = (error as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') return payloadTooLarge(limitBytes);
  if (type === 'request.aborted' || type === 'request.size.invalid') return new ApiException('invalid_json');
  return error;
}

function parseBody(request: Request, encoding: string | undefined): ParsedBody {
  const bytes: unknown = request.body;
  request.body = undefined;
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { present: false };
  if (!isUncompressed(encoding) || !isAcceptedContentType(request.headers['content-type'])) {
    throw new ApiException('unsupported_media_type');
  }
  const text = decodeUtf8(bytes);
  if (text === undefined) throw new ApiException('invalid_json');
  try {
    return { present: true, value: JSON.parse(text) };
  } catch {
    throw new ApiException('invalid_json');
  }
}

/**
 * Lee el cuerpo en bruto (como mucho el máximo de su ruta, `bodyLimitFor`: 1 MiB, o 64 KiB en las dos rutas `POST` de
 * conversaciones; contado tal como llega) y lo decodifica como JSON. Orden de errores: 413, 415 (compresión, tipo de
 * medio o `charset`) y 400 `invalid_json` (no UTF-8 o no JSON). `Content-Encoding` se aparta antes de leer para que el
 * límite cuente los bytes comprimidos y el 413 salga antes que el 415. Sin cuerpo no hay nada que comprobar. El valor lo
 * entrega `@JsonBody()`.
 */
export function readJsonBody(): RequestHandler {
  const readers = new Map<number, RequestHandler>(
    [MAX_BODY_BYTES, MAX_CONVERSATION_BODY_BYTES].map((limit) => [limit, raw({ type: () => true, limit, inflate: false })]),
  );
  return (request: Request, response: Response, next: NextFunction) => {
    const limit = bodyLimitFor(request.method, request.path);
    const read = readers.get(limit)!;
    const encoding = request.headers['content-encoding'];
    delete request.headers['content-encoding'];
    read(request, response, (error?: unknown) => {
      if (error) return next(mapBodyParserError(error, limit));
      try {
        BODIES.set(request, parseBody(request, encoding));
      } catch (failure) {
        return next(failure);
      }
      next();
    });
  };
}

/**
 * Parámetro de manejador: el cuerpo JSON de la petición.
 *
 * @throws {ApiException} `invalid_json` si la petición no trae cuerpo. Se resuelve antes del manejador.
 */
export const JsonBody = createParamDecorator((_data: unknown, context: ExecutionContext): unknown => {
  const body = BODIES.get(context.switchToHttp().getRequest<Request>());
  if (!body?.present) throw new ApiException('invalid_json');
  return body.value;
});
