'use client';

import { useEffect } from 'react';

/**
 * Pide confirmación al recargar o cerrar la pestaña mientras haya cambios sin guardar (`beforeunload`). Solo está
 * registrado con `dirty`; al ocultarse la ruta (`<Activity>`) el efecto se limpia y deja de preguntar.
 *
 * @param dirty Hay cambios sin guardar.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
