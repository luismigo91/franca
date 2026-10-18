import { FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { writeBoolean } from '@/lib/editor/fields';
import type { FieldDescriptor } from '@/lib/editor/node-fields';

/** Casilla. Si no está escrita en el JSON se ve con su valor por defecto. Volver al valor por defecto quita la propiedad. */
export function BooleanField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const meta = useFieldMeta(ctx, pointer);
  const defaultValue = descriptor.defaultValue === true;
  const checked = typeof value === 'boolean' ? value : defaultValue;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          id={meta.id}
          type="checkbox"
          checked={checked}
          aria-describedby={meta.describedBy}
          className="size-4"
          onChange={(event) => ctx.edit(writeBoolean(pointer, event.target.checked, defaultValue))}
        />
        {descriptor.label}
      </label>
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} errorId={meta.errorId} />
    </div>
  );
}
