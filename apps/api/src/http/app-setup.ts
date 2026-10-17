import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Express, NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { CONNECTIONS_CHECKING_INTERVAL_MS, HEADERS_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './limits.js';
import { readJsonBody } from './json-body.js';
import { localOnly } from './local-only.js';

/** La API no hace lecturas condicionales: nunca responde 304. */
function ignoreConditionalReads(request: Request, _response: Response, next: NextFunction): void {
  delete request.headers['if-none-match'];
  delete request.headers['if-modified-since'];
  next();
}

/**
 * Monta la tubería HTTP de la API, la misma en `main.ts` y en los e2e. La app debe crearse con `bodyParser: false`
 * y esta función llamarse antes de `init()`/`listen()`. En orden: sin ETag propio de Express, solo máquina local
 * (`Host` y `Origin`), sin lecturas condicionales, cuerpo JSON en bruto con límite, router de Nest y, al final,
 * el filtro global de errores. Sin CORS: no se llama a `enableCors`. Fija además los plazos de recepción del servidor
 * HTTP, para que una petición con un `Content-Length` falso no retenga la conexión.
 *
 * @param app Aplicación de Nest sobre Express.
 * @param options `requestTimeoutMs`: plazo para recibir la petición entera (por defecto `REQUEST_TIMEOUT_MS`); solo
 * los tests lo reducen.
 */
export function configureApp(app: INestApplication, options: { requestTimeoutMs?: number } = {}): void {
  limitRequestReception(app.getHttpServer() as Server, options.requestTimeoutMs);
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('etag', false);
  app.use(localOnly);
  app.use(ignoreConditionalReads);
  app.use(readJsonBody());
  app.useGlobalFilters(new ApiExceptionFilter());
}

/** Plazos de recepción de Node; las cabeceras no pueden tardar más que la petición entera. */
function limitRequestReception(server: Server, requestTimeoutMs = REQUEST_TIMEOUT_MS): void {
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(HEADERS_TIMEOUT_MS, requestTimeoutMs);
  // Node lo lee al empezar a escuchar y lo documenta solo como opción del constructor: no está en los tipos.
  (server as Server & { connectionsCheckingInterval: number }).connectionsCheckingInterval = Math.max(10, Math.min(CONNECTIONS_CHECKING_INTERVAL_MS, Math.floor(requestTimeoutMs / 4)));
}
