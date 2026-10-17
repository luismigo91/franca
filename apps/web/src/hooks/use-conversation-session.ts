'use client';

import { useRouter } from 'next/navigation';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { ConversationSession, defaultSleep, type ConversationSnapshot } from '@/lib/chat/conversation-session';
import { clearFirstAdvance, peekFirstAdvance } from '@/lib/chat/first-advance';
import { webClient } from '@/lib/web-client';

/**
 * Adaptador de React de `ConversationSession`. La sesión se crea con el primer avance si venimos de «Probar» (leído sin
 * consumirlo: el render puede repetirse) y se activa al montarse y al volver a mostrarse (`<Activity>`).
 */
export function useConversationSession(conversationId: string): { session: ConversationSession; snapshot: ConversationSnapshot } {
  const router = useRouter();
  const [session] = useState(
    () => new ConversationSession(conversationId, { client: webClient, sleep: defaultSleep, navigate: (path) => router.push(path), initial: peekFirstAdvance(conversationId) }),
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useLayoutEffect(() => {
    const stop = session.activate();
    // La sesión ya guarda el primer avance: el traspaso en memoria se borra en el primer efecto (D11).
    clearFirstAdvance(conversationId);
    return stop;
  }, [session, conversationId]);

  return { session, snapshot };
}
