import { BadRequestException, type ArgumentsHost, ForbiddenException, Logger, NotFoundException, type LoggerService } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { ApiException } from './api-error.js';
import { ApiExceptionFilter, toErrorResponse } from './api-exception.filter.js';

describe('toErrorResponse', () => {
  it('ApiException: estado, cuerpo exacto con sus campos extra y sus cabeceras', () => {
    const exception = new ApiException('revision_mismatch', { currentRevision: 2 }, { ETag: '"2"' });
    expect(toErrorResponse(exception)).toEqual({
      status: 412,
      body: { message: 'el borrador ha cambiado', error: 'revision_mismatch', currentRevision: 2 },
      headers: { ETag: '"2"' },
      code: 'revision_mismatch',
    });
  });

  it('NotFoundException de Nest (ruta o método sin manejador) es not_found', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /nada'))).toMatchObject({ status: 404, body: { error: 'not_found' } });
  });

  it('el BadRequestException que ExpressAdapter.mapException saca del URIError de %FF es not_found', () => {
    const fromUriError = new BadRequestException(new URIError('Failed to decode param \'%FF\'').message);
    const response = toErrorResponse(fromUriError);
    expect(response.status).toBe(404);
    expect(Object.keys(response.body).sort()).toEqual(['error', 'message']);
    expect(response.body.error).toBe('not_found');
    expect(JSON.stringify(response.body)).not.toContain('%FF');
  });

  it('un BadRequestException que no viene del URIError de la ruta (por ejemplo, de un pipe) no se disfraza de not_found', () => {
    expect(toErrorResponse(new BadRequestException('Validation failed (numeric string is expected)'))).toMatchObject({ status: 500, body: { error: 'internal_error' } });
  });

  it('base no disponible es 503 database_unavailable', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Can\'t reach database server at 127.0.0.1:59999', {
      code: 'P1001',
      clientVersion: '7.10.1',
    });
    expect(toErrorResponse(error)).toMatchObject({ status: 503, body: { error: 'database_unavailable' } });
  });

  it('lo demás es 500 con el cuerpo exacto y sin detalle', () => {
    for (const exception of [new Error('SELECT * FROM flows WHERE draft = {"secreto":1}'), new ForbiddenException('x'), 'texto', undefined]) {
      expect(toErrorResponse(exception)).toMatchObject({
        status: 500,
        body: { message: 'error interno', error: 'internal_error' },
      });
    }
  });
});

describe('ApiExceptionFilter: registro', () => {
  const lines: string[] = [];
  const capture: LoggerService = {
    log: (message: unknown) => lines.push(`log ${String(message)}`),
    error: (message: unknown) => lines.push(`error ${String(message)}`),
    warn: (message: unknown) => lines.push(`warn ${String(message)}`),
  };

  beforeEach(() => {
    lines.length = 0;
    Logger.overrideLogger(capture);
  });
  afterEach(() => Logger.overrideLogger(['log', 'error', 'warn']));

  function run(exception: unknown) {
    const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const response = {
      headersSent: false,
      setHeader: (name: string, value: string) => (sent.headers[name] = value),
      status(code: number) {
        sent.status = code;
        return this;
      },
      json(body: unknown) {
        sent.body = body;
      },
    };
    const request = { method: 'GET', path: '/flows/hola' };
    const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ArgumentsHost;
    new ApiExceptionFilter().catch(exception, host);
    return sent;
  }

  it('un 500 registra método, ruta, estado, código, la clase del error y el P#### de Prisma, nunca el mensaje', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Transaction API error: A query cannot be executed on an expired transaction. SELECT draft FROM flows -- {"nodos":"texto del flujo"}',
      { code: 'P2028', clientVersion: '7.10.1', meta: { query: 'texto del flujo' } },
    );
    const sent = run(error);
    expect(sent.status).toBe(500);
    expect(lines).toEqual(['error GET /flows/hola 500 internal_error PrismaClientKnownRequestError P2028']);
  });

  it('un 503 registra solo método, ruta, estado y código (el mensaje de P1001 lleva host y puerto)', () => {
    run(new Prisma.PrismaClientKnownRequestError("Can't reach database server at 127.0.0.1:59999", { code: 'P1001', clientVersion: '7.10.1' }));
    expect(lines).toEqual(['error GET /flows/hola 503 database_unavailable']);
  });

  it.each(['P1000', 'P1003', 'P1010', 'P1011'])('un 503 por DATABASE_URL mal configurada (%s) añade el código de Prisma, no el mensaje (lleva el nombre de la base)', (code) => {
    const sent = run(new Prisma.PrismaClientKnownRequestError('Database `no_existe_zz` does not exist on the database server', { code, clientVersion: '7.10.1' }));
    expect(sent.status).toBe(503);
    expect(lines).toEqual([`error GET /flows/hola 503 database_unavailable ${code}`]);
  });

  it('un PrismaClientInitializationError registra su errorCode (no tiene code): 503 en configuración, 500 en un despliegue roto', () => {
    expect(run(new Prisma.PrismaClientInitializationError('Database `x` does not exist', '7.10.1', 'P1003')).status).toBe(503);
    expect(run(new Prisma.PrismaClientInitializationError('Query engine library not found', '7.10.1', 'P1012')).status).toBe(500);
    expect(lines).toEqual([
      'error GET /flows/hola 503 database_unavailable P1003',
      'error GET /flows/hola 500 internal_error PrismaClientInitializationError P1012',
    ]);
  });

  it('un error cualquiera registra su clase pero no su mensaje ni su traza', () => {
    run(new TypeError('contenido del flujo: Bearer abc123'));
    expect(lines).toEqual(['error GET /flows/hola 500 internal_error TypeError']);
  });

  it('un 4xx no se registra', () => {
    run(new ApiException('flow_not_found'));
    run(new NotFoundException());
    expect(lines).toEqual([]);
  });

  it('envía las cabeceras y el cuerpo de la ApiException', () => {
    const sent = run(new ApiException('revision_mismatch', { currentRevision: 3 }, { ETag: '"3"' }));
    expect(sent).toEqual({
      status: 412,
      headers: { ETag: '"3"' },
      body: { message: 'el borrador ha cambiado', error: 'revision_mismatch', currentRevision: 3 },
    });
  });
});
