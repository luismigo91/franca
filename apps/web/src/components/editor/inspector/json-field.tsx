'use client';

import { useState } from 'react';
import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { writeJson } from '@/lib/editor/fields';
import type { FieldDescriptor } from '@/lib/editor/node-fields';

export const SHAPE_NOTE = 'Este valor no tiene la forma que edita el formulario: corrígelo como JSON.';

/**
 * JSON libre (`request.body`, predicados con `all`/`any`) y refugio de todo valor que no encaja en la clase de su campo.
 * Un texto que no es JSON se conserva y no se escribe nada; vacío en uno opcional quita la propiedad.
 */
export function JsonField({ descriptor, pointer, value, ctx, note }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext; note?: string }) {
  const [text, setText] = useState(() => (value === undefined ? '' : (JSON.stringify(value, null, 2) ?? '')));
  const [error, setError] = useState<string | null>(null);
  const meta = useFieldMeta(ctx, pointer, error);
  return (
    <FieldBox label={`${descriptor.label} (JSON)`} htmlFor={meta.id}>
      {note !== undefined && <p className="text-xs opacity-80">{note}</p>}
      <textarea
        id={meta.id}
        rows={4}
        spellCheck={false}
        value={text}
        aria-describedby={meta.describedBy}
        aria-invalid={error !== null || undefined}
        className={`${CONTROL_CLASS} font-mono`}
        onChange={(event) => {
          setText(event.target.value);
          const result = ctx.edit(writeJson(pointer, event.target.value, descriptor.required === true));
          setError(result.ok ? null : result.error);
        }}
      />
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} error={error} errorId={meta.errorId} />
    </FieldBox>
  );
}
