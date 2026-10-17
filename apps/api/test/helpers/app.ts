import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';
import { CLOCK, type Clock } from '../../src/flows/clock.js';
import { configureApp } from '../../src/http/app-setup.js';

export interface TestApp {
  app: INestApplication;
  /** Servidor HTTP para `supertest`. */
  server: Server;
  /** Puerto de loopback en el que escucha (para peticiones en bruto). */
  port: number;
  close(): Promise<void>;
}

/** Reloj determinista: cada llamada devuelve un instante 1 ms posterior a la anterior (desde 2026-10-17T10:00:00Z). */
export function steppingClock(start = Date.UTC(2026, 9, 17, 10, 0, 0)): Clock {
  let current = start - 1;
  return { now: () => new Date((current += 1)) };
}

/** Logger que no escribe nada (Nest en testing, por defecto, escribe los errores en `stderr`). */
const SILENT_LOGGER: LoggerService = { log: () => undefined, error: () => undefined, warn: () => undefined };

export interface CreateTestAppOptions {
  /** Logger de Nest (por defecto, uno silencioso). Pasa el de `captureOutput()` para comprobar lo que se registra. */
  logger?: LoggerService;
  /** Sustituye partes de la configuración (por ejemplo, `databaseUrl` hacia un puerto cerrado). */
  config?: Partial<AppConfig>;
  /** Plazo para recibir la petición entera (`configureApp`); solo para probar el 408 sin esperar 30 s. */
  requestTimeoutMs?: number;
  /** Sustituye proveedores (`overrideProvider(...).useValue(...)`) antes de compilar. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Crea la aplicación completa (mismo `AppModule`, `bodyParser: false` y `configureApp` que `main.ts`) y la
 * inicializa. Los tests ejercitan así la misma tubería que producción.
 */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.config) {
    const fromEnv: AppConfig = { host: '127.0.0.1', port: 0, databaseUrl: process.env.DATABASE_URL ?? '' };
    builder = builder.overrideProvider(APP_CONFIG).useValue({ ...fromEnv, ...options.config });
  }
  builder = builder.overrideProvider(CLOCK).useValue(steppingClock()).setLogger(options.logger ?? SILENT_LOGGER);
  if (options.configure) builder = options.configure(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureApp(app, { requestTimeoutMs: options.requestTimeoutMs });
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as Server;
  return { app, server, port: (server.address() as AddressInfo).port, close: () => app.close() };
}
