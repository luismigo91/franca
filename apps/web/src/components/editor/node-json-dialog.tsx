'use client';

import { useRef, useState } from 'react';
import { useModalDialog } from '@/components/editor/use-modal-dialog';
import { Button } from '@/components/ui/button';

interface NodeJsonDialogProps {
  open: boolean;
  /** El JSON del nodo seleccionado, con el que se abre el diálogo. */
  initialText: string;
  onClose: () => void;
  /** Aplica el texto. Devuelve el error, o `null` si se aplicó. */
  onApply: (text: string) => string | null;
}

/**
 * «Editar como JSON»: el JSON del nodo en un campo de texto. Al aplicarlo sustituye el nodo; si el texto no es un objeto
 * JSON (o anidaría demasiados niveles) lo dice, conserva el texto y no cambia nada.
 */
export function NodeJsonDialog({ open, initialText, onClose, onApply }: NodeJsonDialogProps) {
  const dialog = useModalDialog(open);
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  // Cada vez que se abre, parte del JSON actual del nodo (se ajusta durante el render, sin efecto).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(initialText);
      setError(null);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="node-json-title"
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-foreground/30 bg-background p-5 text-foreground overscroll-contain backdrop:bg-black/50"
    >
      <h2 id="node-json-title" className="text-lg font-semibold">
        Editar como JSON
      </h2>
      <label htmlFor="node-json-text" className="mt-2 block text-sm">
        JSON del nodo
      </label>
      <textarea
        id="node-json-text"
        ref={area}
        rows={14}
        spellCheck={false}
        value={text}
        aria-invalid={error !== null || undefined}
        aria-describedby={error === null ? undefined : 'node-json-error'}
        className="mt-1 w-full rounded-md border border-foreground/30 bg-background p-2 font-mono text-xs aria-[invalid=true]:border-red-700"
        onChange={(event) => setText(event.target.value)}
      />
      {error !== null && (
        <p id="node-json-error" role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          onClick={() => {
            const failure = onApply(text);
            setError(failure);
            if (failure !== null) area.current?.focus();
          }}
        >
          Aplicar
        </Button>
      </div>
    </dialog>
  );
}
