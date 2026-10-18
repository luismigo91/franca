'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/editor/confirm-dialog';
import { WEB_PAGES } from '@/config/endpoints';

/** Las páginas a las que lleva el editor. */
export type GuardedPage = 'home' | 'flows';

/**
 * Enlace de la web que, con cambios sin guardar, pide confirmación antes de salir (D15). `onNavigate` solo corre en
 * navegaciones del cliente: abrir en otra pestaña no pregunta. «Salir» navega con el router.
 */
export function GuardedLink({ page, dirty, children }: { page: GuardedPage; dirty: boolean; children: ReactNode }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Link
        href={WEB_PAGES[page]}
        className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        onNavigate={(event) => {
          if (!dirty) return;
          event.preventDefault();
          setConfirming(true);
        }}
      >
        {children}
      </Link>
      <ConfirmDialog
        open={confirming}
        title="¿Salir sin guardar?"
        confirmLabel="Salir"
        cancelLabel="Seguir editando"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          router.push(WEB_PAGES[page]);
        }}
      >
        Hay cambios sin guardar. Si sales, se pierden.
      </ConfirmDialog>
    </>
  );
}
