import { type ArgumentsHost, BadRequestException, Catch, type ExceptionFilter, HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isDatabaseUnavailable } from '../prisma/database-errors.js';
import { ApiException, type ApiErrorCode, describeApiError } from './api-error.js';

/** Respuesta de error ya resuelta: estado, cuerpo exacto y cabeceras. */
export interface ErrorResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  code: ApiErrorCode;
}

function plain(code: ApiErrorCode): ErrorResponse {
  const { status, message } = describeApiError(code);
  return { status, body: { message, error: code }, headers: {}, code };
}

/**
 * Traduce cualquier excepción al contrato de errores `{message, error, ...}`.
 *
 * @param exception Lo capturado (una `ApiException`, una excepción de Nest, un error de Prisma o cualquier cosa).
 * @returns La respuesta que se envía.
 */
export function toErrorResponse(exception: unknown): ErrorResponse {
  if (exception instanceof ApiException) {
    const { message } = describeApiError(exception.code);
    return {
      status: exception.getStatus(),
      body: { message, error: exception.code, ...exception.extra },
      headers: exception.headers,
      code: exception.code,
    };
  }
  // Ruta o método sin manejador.
  if (exception instanceof NotFoundException) return plain('not_found');
  // La única fuente de un BadRequestException ajeno es el `URIError` de una ruta con `%` mal formado
  // (no hay `ValidationPipe` ni body parser de Nest): `GET /flows/%FF` es una ruta que no existe.
  if (exception instanceof BadRequestException) return plain('not_found');
  if (isDatabaseUnavailable(exception)) return plain('database_unavailable');
  return plain('internal_error');
}

/** `P####` de un error de Prisma, para el registro de un 500. */
function prismaCode(exception: unknown): string | undefined {
  const code = (exception as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : undefined;
}

/**
 * Filtro global: ninguna excepción llega al manejador por defecto de Nest (que registra trazas). El registro de un
 * 5xx lleva solo método, ruta, estado y código y, en un 500, la clase del error y su `P####`: nunca `message`, `meta`,
 * `stack`, cuerpos ni cabeceras (el mensaje de P1001 lleva host y puerto; otros pueden llevar contenido de flujos).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, body, headers, code } = toErrorResponse(exception);
    if (status >= 500) this.logger.error(this.describe(request, status, code, exception));
    if (response.headersSent) {
      response.end();
      return;
    }
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.status(status).json(body);
  }

  private describe(request: Request, status: number, code: ApiErrorCode, exception: unknown): string {
    const base = `${request.method} ${request.path} ${status} ${code}`;
    if (code !== 'internal_error') return base;
    const kind = exception instanceof Error || exception instanceof HttpException ? exception.constructor.name : typeof exception;
    const prisma = prismaCode(exception);
    return prisma ? `${base} ${kind} ${prisma}` : `${base} ${kind}`;
  }
}
