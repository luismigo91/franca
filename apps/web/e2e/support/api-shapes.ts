import type { IncomingMessage } from 'node:http';
import type { ConversationResource, TranscriptItem } from '@/lib/chat/api-types';
import { CONVERSATION_ID, flowItem, messageEvent, pageOf, resourceOf, textInputEvent, userItem } from '../../tests/helpers/resources';
import { sendJson, type FakeHandler, type RecordedRequest } from '../../tests/helpers/fake-api';

export { CONVERSATION_ID, flowItem, messageEvent, pageOf, resourceOf, textInputEvent, userItem };

/**
 * Formas de recursos, páginas y avances de la API simulada. `fake-api-shapes.e2e.ts` compara sus claves y su orden con
 * las de la API real, para que ningún doble tenga la forma que su autor creía.
 */
export interface World {
  conversation: ConversationResource;
  items: TranscriptItem[];
  flowName?: string;
}

export type InputHandler = (request: RecordedRequest, response: Parameters<FakeHandler>[1], socket: Parameters<FakeHandler>[2], world: World) => void | Promise<void>;

/** Una API simulada con una conversación: lee el recurso, la transcripción y la versión; las entradas las decide `onInput`. */
export function scripted(world: World, onInput: InputHandler): FakeHandler {
  return async (request, response, socket) => {
    const url = new URL(request.path, 'http://x');
    const id = world.conversation.id;
    if (request.method === 'GET' && url.pathname === `/conversations/${id}`) return sendJson(response, 200, world.conversation);
    if (request.method === 'GET' && url.pathname === `/conversations/${id}/transcript`) {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      return sendJson(response, 200, { items: world.items.slice(offset, offset + limit), total: world.items.length, limit, offset });
    }
    if (request.method === 'GET' && url.pathname === `/flows/${world.conversation.flowId}/versions/${world.conversation.version}`) {
      return sendJson(response, 200, { flowId: world.conversation.flowId, version: world.conversation.version, name: world.flowName ?? 'Pregunta', publishedAt: world.conversation.createdAt, flow: {}, warnings: [] });
    }
    if (request.method === 'POST' && url.pathname === `/conversations/${id}/inputs`) return onInput(request, response, socket, world);
    if (request.method === 'GET' && url.pathname === '/conversations') return sendJson(response, 200, { items: [], total: 0, limit: 20, offset: 0 });
    return sendJson(response, 404, { message: 'ruta no encontrada', error: 'not_found' });
  };
}

/** Espera `ms` y sigue. */
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type { IncomingMessage };

/** El cuerpo de un avance: el recurso y sus eventos. */
export function advanceBodyOf(conversation: ConversationResource, events: unknown[]): { conversation: ConversationResource; events: unknown[] } {
  return { conversation, events };
}
