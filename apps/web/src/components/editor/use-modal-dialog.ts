'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Un `<dialog>` modal nativo controlado por `open`: `showModal` lo abre (con su gestión del foco y de Escape) y se cierra al
 * ocultarse la ruta (`<Activity>` conserva el DOM y un diálogo modal abierto bloquearía la ruta visible, D15).
 *
 * @param open Si el diálogo debe estar abierto.
 */
export function useModalDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useLayoutEffect(
    () => () => {
      if (ref.current?.open) ref.current.close();
    },
    [],
  );
  return ref;
}
