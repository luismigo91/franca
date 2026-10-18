'use client';

import { useId, type ReactNode } from 'react';
import { useModalDialog } from '@/components/editor/use-modal-dialog';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmación en un `<dialog>` modal nativo (como `DeleteConversationDialog`): gestiona el foco y Escape sin código propio. */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel, danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialog = useModalDialog(open);
  const id = useId();
  return (
    <dialog
      ref={dialog}
      onClose={onCancel}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-foreground/30 bg-background p-5 text-foreground backdrop:bg-black/50"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      <p id={`${id}-body`} className="mt-2 text-sm [overflow-wrap:anywhere]">
        {children}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" autoFocus onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
