import { Logger, Module, Inject, type OnApplicationBootstrap } from '@nestjs/common';
import type { LlmCapability } from '@franca/engine';
import { CLOCK, systemClock } from '../flows/clock.js';
import { ContactsController } from './contacts.controller.js';
import { CONVERSATIONS_CONFIG, loadConversationsConfig, type ConversationsConfig } from './conversations-config.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsRepository } from './conversations.repository.js';
import { ConversationsService } from './conversations.service.js';
import { createLlmProviders, LLM_PROVIDERS } from './llm-providers.js';

/**
 * Conversaciones y contactos. Convive con `flows` sin retocarlo: repositorio, reloj y configuración propios.
 * La configuración se lee del entorno al instanciar los proveedores (importar el módulo no lee nada); `main.ts` la valida
 * antes de abrir el puerto.
 */
@Module({
  controllers: [ConversationsController, ContactsController],
  providers: [
    ConversationsService,
    ConversationsRepository,
    { provide: CLOCK, useValue: systemClock },
    { provide: CONVERSATIONS_CONFIG, useFactory: () => loadConversationsConfig(process.env) },
    { provide: LLM_PROVIDERS, useFactory: (config: ConversationsConfig) => createLlmProviders(config), inject: [CONVERSATIONS_CONFIG] },
  ],
})
export class ConversationsModule implements OnApplicationBootstrap {
  constructor(@Inject(LLM_PROVIDERS) private readonly providers: ReadonlyMap<string, LlmCapability>) {}

  /** Línea de arranque: dice si hay proveedor `principal`; nunca muestra la clave. */
  onApplicationBootstrap(): void {
    const logger = new Logger('Conversations');
    if (this.providers.has('principal')) logger.log('proveedor llm principal: Claude');
    else logger.warn('sin proveedor llm principal: falta FRANCA_ANTHROPIC_API_KEY; los nodos llm fallarán con llm_not_configured');
  }
}
