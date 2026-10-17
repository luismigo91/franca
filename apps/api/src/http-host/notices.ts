import type { BlockReason } from './destination-policy.js';
import type { MissingSecretReason } from './secrets.js';

/** Los dos avisos de operación de la salida http. Nada de una llamada va a los registros fuera de ellos. */
export interface HttpNotices {
  missingSecret(notice: { conversationId: string; nodeId: string; secret: string; reason: MissingSecretReason }): void;
  blocked(notice: { conversationId: string; nodeId: string; reason: BlockReason }): void;
}

/** Destino de los avisos: el logger de Nest en producción. */
export interface NoticeSink {
  warn(message: string): void;
}

/**
 * Los avisos como líneas del registro, con plantillas fijas: sin URL, origen, nombre de host, direcciones, cabeceras ni
 * cuerpos. Los nombres de secreto no son secretos y quien opera los necesita para arreglar la configuración.
 *
 * @param sink Dónde se escriben.
 * @returns Los avisos.
 */
export function createLoggerNotices(sink: NoticeSink): HttpNotices {
  return {
    missingSecret: ({ conversationId, nodeId, secret, reason }) =>
      sink.warn(`conversación ${conversationId}: missing_secret en el nodo ${nodeId}, secreto ${secret} (${reason})`),
    blocked: ({ conversationId, nodeId, reason }) => sink.warn(`conversación ${conversationId}: blocked en el nodo ${nodeId} (${reason})`),
  };
}
