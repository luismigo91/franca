'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ChatErrorCode } from '@/lib/chat/copy';
import { startConversation } from '@/lib/chat/first-advance';
import { webClient } from '@/lib/web-client';

export interface StartState {
  /** El flujo cuya conversación se está creando: su botón dice «Iniciando…» y los demás se desactivan. */
  startingFlowId: string | null;
  error: { flowId: string; code: ChatErrorCode } | null;
}

const IDLE: StartState = { startingFlowId: null, error: null };

/**
 * «Probar» (D8, D11): crea la conversación, guarda el primer avance en memoria y navega. Un solo «Probar» a la vez.
 *
 * @param onFlowGone Se llama si el flujo ya no existe (`flow_not_found`): la lista se vuelve a leer.
 */
export function useStartConversation(onFlowGone: () => void) {
  const router = useRouter();
  const [state, setState] = useState<StartState>(IDLE);
  const busy = useRef(false);

  // Al ocultarse la página (al navegar a la conversación) vuelve a su estado inicial.
  useLayoutEffect(
    () => () => {
      busy.current = false;
      setState(IDLE);
    },
    [],
  );

  const start = useCallback(
    async (flowId: string, contactId: string) => {
      if (busy.current) return;
      busy.current = true;
      setState({ startingFlowId: flowId, error: null });
      const result = await startConversation(webClient, flowId, contactId, (path) => router.push(path));
      if (result.ok) return;
      busy.current = false;
      setState({ startingFlowId: null, error: { flowId, code: result.code } });
      if (result.code === 'flow_not_found') onFlowGone();
    },
    [router, onFlowGone],
  );

  return { state, start };
}
