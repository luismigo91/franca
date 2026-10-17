import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { AppModule } from './app.module.js';
import { ConfigError, loadConfig, type AppConfig } from './config/app-config.js';
import { configureApp } from './http/app-setup.js';

/** Lee la configuración antes de crear nada: con una configuración inválida no se abre ningún puerto. */
function readConfig(): AppConfig | undefined {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return undefined;
  }
}

/** `127.0.0.1:3001` o `[::1]:3001`. */
function formatAddress({ address, port }: AddressInfo): string {
  return `${address.includes(':') ? `[${address}]` : address}:${port}`;
}

async function bootstrap(): Promise<void> {
  const config = readConfig();
  if (!config) return;
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  // La dirección real del socket, no `app.getUrl()`: reescribe `::` y `0.0.0.0` y escondería justo el error que se quiere ver.
  const address = app.getHttpServer().address() as AddressInfo;
  new Logger('Bootstrap').log(`Franca API escuchando en ${formatAddress(address)}`);
}

await bootstrap();
