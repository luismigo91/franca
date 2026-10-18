'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NODE_TYPE_LABELS, NODE_TYPES } from '@/lib/editor/node-types';

/** «Añadir nodo»: un botón con `aria-expanded` que muestra los ocho tipos como botones. Escape lo cierra y devuelve el foco. */
export function AddNodeMenu({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <Button ref={trigger} variant="secondary" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        Añadir nodo
      </Button>
      {open && (
        <div role="group" aria-label="Tipos de nodo" className="absolute left-0 top-full z-20 mt-1 flex w-48 flex-col gap-1 rounded-md border border-foreground/30 bg-background p-1 shadow-lg">
          {NODE_TYPES.map((type) => (
            <Button
              key={type}
              variant="secondary"
              className="justify-start"
              onClick={() => {
                setOpen(false);
                onAdd(type);
              }}
            >
              {NODE_TYPE_LABELS.get(type)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
