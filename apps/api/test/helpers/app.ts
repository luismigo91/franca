import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';
import { configureApp } from '../../src/http/app-setup.js';

export interface TestApp {
  app: INestApplication;
  /** Servidor HTTP para `supertest`. */
  server: Server;
  /** Puerto de loopback en el que escucha (para peticiones en bruto). */
  port: number;
  close(): Promise<void>;
}

export interface CreateTestAppOptions {
  /** Sustituye partes de la configuración (por ejemplo, `databaseUrl` hacia un puerto cerrado). */
  config?: Partial<AppConfig>;
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
  if (options.configure) builder = options.configure(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as Server;
  return { app, server, port: (server.address() as AddressInfo).port, close: () => app.close() };
}
