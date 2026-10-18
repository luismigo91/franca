'use client';

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { EditorSession, type EditorSnapshot } from '@/lib/editor/editor-session';
import { editorClient } from '@/lib/web-client';

/**
 * Adaptador de React de `EditorSession` (D15). La sesión se crea una vez; lee el flujo al montarse **y** al volver a
 * mostrarse (`<Activity>` repite el `useEffect`), y suelta el borrador en el *cleanup* de un `useLayoutEffect`, que corre
 * antes de que la ruta se oculte: al volver no se ve ni un instante el estado anterior y no se recupera nada de la visita.
 * En `StrictMode` el doble montaje hace `reset` y `open` dos veces, sin efectos (la época descarta la primera lectura).
 */
export function useEditorSession(flowId: string): { session: EditorSession; snapshot: EditorSnapshot } {
  const [session] = useState(() => new EditorSession(flowId, editorClient));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(() => {
    void session.open();
  }, [session]);

  useLayoutEffect(() => () => session.reset(), [session]);

  return { session, snapshot };
}
