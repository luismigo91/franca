import { FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import { InspectorField } from '@/components/editor/inspector/inspector-field';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { Button } from '@/components/ui/button';
import { addItem, removeItem } from '@/lib/editor/fields';
import type { FieldDescriptor } from '@/lib/editor/node-fields';

/** Una lista de objetos (reglas, opciones, asignaciones, variables…): un grupo por elemento, con «Quitar» y «Añadir». */
export function ListField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const meta = useFieldMeta(ctx, pointer, null, true);
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  const itemLabel = descriptor.itemLabel ?? 'elemento';
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={meta.describedBy}>
      <legend className="text-sm font-medium">{descriptor.label}</legend>
      {items.map((_, index) => (
        <fieldset key={index} className="flex min-w-0 flex-col gap-2 rounded-md border border-foreground/20 p-2">
          <legend className="px-1 text-xs opacity-70">
            {itemLabel} {index + 1}
          </legend>
          {(descriptor.fields ?? []).map((field) => (
            <InspectorField key={field.key} descriptor={field} pointer={`${pointer}/${index}/${field.key}`} ctx={ctx} />
          ))}
          <Button variant="secondary" className="self-start" aria-label={`Quitar ${itemLabel} ${index + 1}`} onClick={() => {
              ctx.edit(removeItem(`${pointer}/${index}`));
              ctx.focusInspector();
            }}>
            Quitar {itemLabel}
          </Button>
        </fieldset>
      ))}
      <Button variant="secondary" className="self-start" aria-label={`Añadir ${itemLabel}`} onClick={() => ctx.edit(addItem(pointer, descriptor))}>
        Añadir {itemLabel}
      </Button>
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} errorId={meta.errorId} />
    </fieldset>
  );
}
