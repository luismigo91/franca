'use client';

import { useState } from 'react';
import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { asText } from '@/lib/editor/as-text';
import { writeNumber } from '@/lib/editor/fields';
import type { FieldDescriptor } from '@/lib/editor/node-fields';

/**
 * Numérico: guarda un número si el texto es decimal y, si no, el texto, para que lo señale el validador. Conserva lo
 * escrito mientras tiene el foco (`1.50` no salta a `1.5`).
 */
export function NumberField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const meta = useFieldMeta(ctx, pointer);
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <FieldBox label={descriptor.label} htmlFor={meta.id}>
      <input
        id={meta.id}
        type="text"
        inputMode="decimal"
        value={typed ?? asText(value)}
        aria-describedby={meta.describedBy}
        aria-invalid={meta.problems.some((problem) => problem.kind === 'issue') || undefined}
        className={CONTROL_CLASS}
        onChange={(event) => {
          setTyped(event.target.value);
          ctx.edit(writeNumber(pointer, event.target.value, descriptor.required === true));
        }}
        onBlur={() => setTyped(null)}
      />
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} errorId={meta.errorId} />
    </FieldBox>
  );
}
