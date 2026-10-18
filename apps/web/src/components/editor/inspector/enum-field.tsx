import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { writeEnum } from '@/lib/editor/fields';
import type { FieldDescriptor } from '@/lib/editor/node-fields';

/** Lista cerrada con las opciones del esquema. Un valor opcional tiene «(por defecto: X)» o «(ninguno)», que quita la propiedad. */
export function EnumField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const meta = useFieldMeta(ctx, pointer);
  const options = descriptor.options ?? [];
  const current = typeof value === 'string' ? value : '';
  const emptyLabel = descriptor.defaultValue !== undefined ? `(por defecto: ${String(descriptor.defaultValue)})` : '(ninguno)';
  return (
    <FieldBox label={descriptor.label} htmlFor={meta.id}>
      <select
        id={meta.id}
        value={current}
        aria-describedby={meta.describedBy}
        className={CONTROL_CLASS}
        onChange={(event) => ctx.edit(writeEnum(pointer, event.target.value === '' ? null : event.target.value))}
      >
        {descriptor.required !== true && <option value="">{emptyLabel}</option>}
        {descriptor.required === true && current === '' && <option value="">(sin elegir)</option>}
        {current !== '' && !options.includes(current) && <option value={current}>{current} (no válido)</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} errorId={meta.errorId} />
    </FieldBox>
  );
}
