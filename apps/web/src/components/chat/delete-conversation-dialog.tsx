'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/chat/copy';

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** Confirmación del borrado en un `<dialog>` modal nativo: gestiona el foco y Escape sin código propio. */
export function DeleteConversationDialog({ open, onClose, onConfirm }: DeleteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="delete-title"
      aria-describedby="delete-body"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-foreground/30 bg-background p-5 text-foreground backdrop:bg-black/50"
    >
      <h2 id="delete-title" className="text-lg font-semibold">
        {COPY.removeTitle}
      </h2>
      <p id="delete-body" className="mt-2 text-sm">
        {COPY.removeBody}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" autoFocus onClick={onClose}>
          {COPY.removeCancel}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {COPY.removeConfirm}
        </Button>
      </div>
    </dialog>
  );
}
