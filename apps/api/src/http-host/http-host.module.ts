import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { createAllowedDestinations } from './destination-policy.js';
import { describeHttpHostConfig, loadHttpHostConfig, type HttpHostConfig } from './http-host-config.js';
import { createHttpHost, type HttpHost } from './http-host.js';
import { createLocalNames } from './local-names.js';
import { systemNetwork, type HttpNetwork } from './network.js';
import { createLoggerNotices } from './notices.js';
import { createSecretStore } from './secrets.js';

/** Token de la configuración de la salida http ya validada. */
export const HTTP_HOST_CONFIG = Symbol('HTTP_HOST_CONFIG');
/** Token de la costura de red (resolutor y abridor de sockets): los e2e lo sustituyen siempre por la red del test. */
export const HTTP_NETWORK = Symbol('HTTP_NETWORK');
/** Token de la salida http, de la que cada avance saca su capacidad `http`. */
export const HTTP_HOST = Symbol('HTTP_HOST');

/**
 * La salida `http` de la API (`http-host`). Convive con las conversaciones sin retocarlas: configuración, red y host
 * propios. La configuración se lee del entorno al instanciar (importar el módulo no lee nada); `main.ts` la valida antes
 * de abrir el puerto. Exporta solo `HTTP_HOST`.
 */
@Module({
  providers: [
    { provide: HTTP_HOST_CONFIG, useFactory: (): Promise<HttpHostConfig> => loadHttpHostConfig(process.env) },
    { provide: HTTP_NETWORK, useFactory: (): HttpNetwork => systemNetwork() },
    {
      provide: HTTP_HOST,
      useFactory: (config: HttpHostConfig, network: HttpNetwork): HttpHost =>
        createHttpHost({
          secrets: createSecretStore(config.secrets),
          allowed: createAllowedDestinations(config.allowedDestinations),
          network,
          localNames: createLocalNames(config.localNames),
          notices: createLoggerNotices(new Logger('HttpHost')),
        }),
      inject: [HTTP_HOST_CONFIG, HTTP_NETWORK],
    },
  ],
  exports: [HTTP_HOST],
})
export class HttpHostModule implements OnApplicationBootstrap {
  constructor(@Inject(HTTP_HOST_CONFIG) private readonly config: HttpHostConfig) {}

  /** Línea de arranque: qué secretos hay con sus orígenes, cuáles se ignoran, qué destinos se permiten y qué nombres locales hay. Nunca un valor. */
  onApplicationBootstrap(): void {
    new Logger('HttpHost').log(describeHttpHostConfig(this.config));
  }
}
