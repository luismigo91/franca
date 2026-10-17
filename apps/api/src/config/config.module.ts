import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './app-config.js';

/** Configuración validada, leída del entorno cuando Nest instancia los proveedores (importar el módulo no lee nada). */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
