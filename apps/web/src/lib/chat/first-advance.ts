import { WEB_PAGES } from '@/config/endpoints';
import type { ConversationResource } from '@/lib/chat/api-types';
import type { ChatErrorCode } from '@/lib/chat/copy';
import type { WebClient } from '@/lib/web-client';

/** El primer avance de una conversación recién creada: lo que devolvió el `201`. */
export interface FirstAdvance {
  conversationId: string;
  conversation: ConversationResource;
  events: unknown[];
}

/**
 * Traspaso del primer avance en **memoria de módulo** (D11), solo el último. No es `sessionStorage` ni nada que
 * sobreviva a recargar: al recargar la página se reconstruye desde la transcripción, sin ritmo.
 */
let latest: FirstAdvance | null = null;

/** Guarda el primer avance, sustituyendo el anterior. */
export function setFirstAdvance(advance: FirstAdvance): void {
  latest = advance;
}

/** Lee el traspaso de una conversación sin consumirlo (idempotente: el render puede repetirse). */
export function peekFirstAdvance(conversationId: string): FirstAdvance | null {
  return latest !== null && latest.conversationId === conversationId ? latest : null;
}

/** Borra el traspaso de una conversación (o cualquiera si no se indica). */
export function clearFirstAdvance(conversationId?: string): void {
  if (conversationId === undefined || latest?.conversationId === conversationId) latest = null;
}

export type StartResult = { ok: true; conversationId: string } | { ok: false; code: ChatErrorCode };

/**
 * Crea una conversación, guarda su primer avance y navega a ella. Lo usan «Probar» y «Empezar de nuevo».
 *
 * @param client Cliente del navegador.
 * @param flowId Flujo a probar (su última versión publicada).
 * @param contactId Contacto: `''` es «sin contacto» (el cliente omite la clave).
 * @param navigate Navegación del router.
 * @returns El id creado, o el código del fallo.
 */
export async function startConversation(
  client: Pick<WebClient, 'createConversation'>,
  flowId: string,
  contactId: string,
  navigate: (path: string) => void,
): Promise<StartResult> {
  const result = await client.createConversation(flowId, contactId);
  if (!result.ok) return { ok: false, code: result.code };
  const { conversation, events } = result.body;
  setFirstAdvance({ conversationId: conversation.id, conversation, events });
  navigate(WEB_PAGES.conversation(conversation.id));
  return { ok: true, conversationId: conversation.id };
}
