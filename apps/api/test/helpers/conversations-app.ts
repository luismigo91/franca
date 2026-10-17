import type { LoggerService } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { CONVERSATIONS_CONFIG, type ConversationsConfig } from '../../src/conversations/conversations-config.js';
import { LLM_PROVIDERS } from '../../src/conversations/llm-providers.js';
import { CLOCK } from '../../src/flows/clock.js';
import type { AppConfig } from '../../src/config/app-config.js';
import { createTestApp, type TestApp } from './app.js';
import { ManualClock } from './conversations-clock.js';
import { ScriptedLlm } from './conversations-llm.js';

export interface ConversationsTestAppOptions {
  /** Presupuesto de coste por conversación (por defecto el de producción, 0.5). */
  costLimitUsd?: number;
  logger?: LoggerService;
  /** Sustituye partes de la configuración general (por ejemplo, `databaseUrl`). */
  config?: Partial<AppConfig>;
  requestTimeoutMs?: number;
  /** Sustituciones propias (repositorios de test); se aplican antes que las obligatorias de este helper. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  /** Reloj manual propio (por defecto uno nuevo). */
  clock?: ManualClock;
}

export interface ConversationsTestApp extends TestApp {
  /** El proveedor `principal` guionizado: la API no tiene otro. */
  llm: ScriptedLlm;
  clock: ManualClock;
}

/**
 * La aplicación completa para los e2e de conversaciones. **Siempre** sustituye `LLM_PROVIDERS` por un mapa cuyo único
 * proveedor es el delegado guionizado y `CONVERSATIONS_CONFIG` por una sin clave de Claude, pase lo que pase en la
 * shell, y el reloj por uno manual. Después de compilar comprueba las sustituciones y, si alguna no está, lanza antes de
 * cualquier petición: ningún e2e puede llamar a Anthropic.
 */
export async function createConversationsTestApp(options: ConversationsTestAppOptions = {}): Promise<ConversationsTestApp> {
  const llm = new ScriptedLlm();
  const clock = options.clock ?? new ManualClock();
  const config: ConversationsConfig = { anthropicApiKey: null, costLimitUsd: options.costLimitUsd ?? 0.5 };
  const providers = new Map([['principal', llm.provider]]);
  const testApp = await createTestApp({
    logger: options.logger,
    config: options.config,
    requestTimeoutMs: options.requestTimeoutMs,
    configure: (builder) =>
      (options.configure ? options.configure(builder) : builder)
        .overrideProvider(CLOCK)
        .useValue(clock)
        .overrideProvider(CONVERSATIONS_CONFIG)
        .useValue(config)
        .overrideProvider(LLM_PROVIDERS)
        .useValue(providers),
  });
  const actualConfig = testApp.app.get<ConversationsConfig>(CONVERSATIONS_CONFIG, { strict: false });
  const actualProviders = testApp.app.get<Map<string, unknown>>(LLM_PROVIDERS, { strict: false });
  if (actualConfig.anthropicApiKey !== null || actualProviders.size !== 1 || actualProviders.get('principal') !== llm.provider) {
    await testApp.close();
    throw new Error('la app de test de conversaciones no usa el proveedor simulado: se abortan los e2e antes de llamar a Anthropic');
  }
  return { ...testApp, llm, clock };
}
