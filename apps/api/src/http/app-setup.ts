import type { INestApplication } from '@nestjs/common';
import type { Express, NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter } from './api-exception.filter.js';
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
 * el filtro global de errores. Sin CORS: no se llama a `enableCors`.
 *
 * @param app Aplicación de Nest sobre Express.
 */
export function configureApp(app: INestApplication): void {
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('etag', false);
  app.use(localOnly);
  app.use(ignoreConditionalReads);
  app.use(readJsonBody());
  app.useGlobalFilters(new ApiExceptionFilter());
}
