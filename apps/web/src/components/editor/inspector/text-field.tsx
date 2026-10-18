import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { asText } from '@/lib/editor/as-text';
import { writeText } from '@/lib/editor/fields';
import type { FieldDescriptor } from '@/lib/editor/node-fields';

/** Texto y plantillas: se escribe tal cual en el JSON en cada pulsación, sin recortar. */
export function TextField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const meta = useFieldMeta(ctx, pointer);
  const shown = asText(value);
  const props = {
    id: meta.id,
    value: shown,
    'aria-describedby': meta.describedBy,
    'aria-invalid': meta.problems.some((problem) => problem.kind === 'issue') || undefined,
    className: CONTROL_CLASS,
    onChange: (event: { target: { value: string } }) => void ctx.edit(writeText(pointer, event.target.value, descriptor.required === true)),
  };
  return (
    <FieldBox label={descriptor.label} htmlFor={meta.id}>
      {descriptor.multiline === true ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} errorId={meta.errorId} />
    </FieldBox>
  );
}
