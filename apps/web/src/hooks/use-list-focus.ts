'use client';

import { useEffect, useRef } from 'react';

/**
 * Evita que el foco caiga a `body` cuando una lista se recarga o crece (accesibilidad solo con teclado). `remember` se
 * llama al empezar la lectura; cuando termina (`busy` pasa a `false`) y el foco quedó en `body` porque el control que lo
 * tenía se desmontó, el foco va al elemento de la lista que está en `index` (el primero nuevo tras «Ver más») o, con
 * `-1`, al encabezado de la sección.
 *
 * @param busy `true` mientras la lista lee.
 * @returns `[ref de la sección (con su `<h2 tabIndex={-1}>`), remember]`.
 */
export function useListFocus(busy: boolean) {
  const section = useRef<HTMLElement>(null);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const index = pending.current;
    if (index === null || busy) return;
    pending.current = null;
    if (document.activeElement !== document.body && document.activeElement !== null) return;
    const root = section.current;
    const target = index >= 0 ? root?.querySelectorAll('li')[index]?.querySelector<HTMLElement>('a,button') : null;
    (target ?? root?.querySelector<HTMLElement>('h2'))?.focus();
  });

  const remember = (index: number) => {
    pending.current = index;
  };
  return [section, remember] as const;
}
