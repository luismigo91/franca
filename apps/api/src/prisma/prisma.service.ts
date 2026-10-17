import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { DATABASE_CONNECT_TIMEOUT_MS, DATABASE_QUERY_TIMEOUT_MS } from './limits.js';

/**
 * Cliente de Prisma con el adaptador de `pg`. Conexión perezosa (sin `$connect` al iniciar): la API arranca con
 * Postgres parado y conecta en la primera consulta. Sin `log`: Prisma no registra consultas, que llevan contenido
 * de flujos. `errorFormat: 'minimal'` recorta los mensajes de error.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
        query_timeout: DATABASE_QUERY_TIMEOUT_MS,
      }),
      errorFormat: 'minimal',
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
