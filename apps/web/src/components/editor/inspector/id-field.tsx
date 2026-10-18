'use client';

import { useState } from 'react';
import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { asText } from '@/lib/editor/as-text';
import type { FieldDescriptor } from '@/lib/editor/node-fields';
import { checkNodeId } from '@/lib/editor/rename';

/**
 * Renombrar un nodo: tiene su propio texto y aplica el cambio al perder el foco o con Intro, si es válido. Mientras se
 * escribe dice si el id no cumple el patrón o ya lo tiene otro nodo, y no cambia nada hasta que es válido.
 */
export function IdField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const current = asText(value);
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? current;
  const problem = typed === null || typed === current ? null : checkNodeId(ctx.flow, current, typed);
  const meta = useFieldMeta(ctx, pointer, problem);
  const commit = () => {
    if (typed === null || typed === current || problem !== null) return;
    const result = ctx.rename(current, typed);
    if (result.ok) setTyped(null);
  };
  return (
    <FieldBox label={descriptor.label} htmlFor={meta.id}>
      <input
        id={meta.id}
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={text}
        aria-describedby={meta.describedBy}
        aria-invalid={problem !== null || undefined}
        className={CONTROL_CLASS}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
      />
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} error={problem} errorId={meta.errorId} />
    </FieldBox>
  );
}
