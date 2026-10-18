import { InspectorField } from '@/components/editor/inspector/inspector-field';
import { JsonField } from '@/components/editor/inspector/json-field';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { Button } from '@/components/ui/button';
import { writeJson } from '@/lib/editor/fields';
import { isRecord } from '@/lib/editor/json-edit';
import { RULE_FIELDS, type FieldDescriptor } from '@/lib/editor/node-fields';

const GROUP_NOTE = 'Las condiciones combinadas (all / any) se editan como JSON.';

/** El `when` de una regla: una regla simple (`variable`, `op`, `value`) con campos, o `all`/`any` como texto JSON. */
export function PredicateField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  if (!isRecord(value) || !Object.hasOwn(value, 'variable')) return <JsonField descriptor={descriptor} pointer={pointer} value={value} ctx={ctx} note={GROUP_NOTE} />;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-sm font-medium">{descriptor.label}</legend>
      {RULE_FIELDS.map((field) => (
        <InspectorField key={field.key} descriptor={field} pointer={`${pointer}/${field.key}`} ctx={ctx} />
      ))}
      <Button variant="secondary" className="self-start" onClick={() => ctx.edit(writeJson(pointer, JSON.stringify({ all: [value] }), true))}>
        Usar condiciones combinadas (JSON)
      </Button>
    </fieldset>
  );
}
