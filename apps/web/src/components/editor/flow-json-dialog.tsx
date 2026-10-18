'use client';

import { useModalDialog } from '@/components/editor/use-modal-dialog';
import { Button } from '@/components/ui/button';

/** «Ver JSON»: el texto JSON del flujo tal como está en el editor (lo que se enviaría al guardar), de solo lectura, con «Copiar». */
export function FlowJsonDialog({ open, text, onClose, onCopy }: { open: boolean; text: string; onClose: () => void; onCopy: () => void }) {
  const dialog = useModalDialog(open);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="flow-json-title"
      className="m-auto w-[min(48rem,calc(100vw-2rem))] rounded-lg border border-foreground/30 bg-background p-5 text-foreground overscroll-contain backdrop:bg-black/50"
    >
      <h2 id="flow-json-title" className="text-lg font-semibold">
        JSON del flujo
      </h2>
      <label htmlFor="flow-json-text" className="mt-2 block text-sm">
        Texto JSON (solo lectura)
      </label>
      <textarea id="flow-json-text" readOnly rows={14} spellCheck={false} value={text} className="mt-1 w-full rounded-md border border-foreground/30 bg-background p-2 font-mono text-xs" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCopy}>
          Copiar
        </Button>
        <Button autoFocus onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </dialog>
  );
}
