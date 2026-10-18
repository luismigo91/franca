import { BooleanField } from '@/components/editor/inspector/boolean-field';
import { ContentField } from '@/components/editor/inspector/content-field';
import { EnumField } from '@/components/editor/inspector/enum-field';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { FieldBox } from '@/components/editor/inspector/field-shell';
import { HeadersField } from '@/components/editor/inspector/headers-field';
import { IdField } from '@/components/editor/inspector/id-field';
import { JsonField, SHAPE_NOTE } from '@/components/editor/inspector/json-field';
import { ListField } from '@/components/editor/inspector/list-field';
import { NumberField } from '@/components/editor/inspector/number-field';
import { PredicateField } from '@/components/editor/inspector/predicate-field';
import { TargetField } from '@/components/editor/inspector/target-field';
import { TextField } from '@/components/editor/inspector/text-field';
import { ValueField } from '@/components/editor/inspector/value-field';
import { asText } from '@/lib/editor/as-text';
import { writeTarget } from '@/lib/editor/fields';
import { getIn } from '@/lib/editor/json-edit';
import { validPosition } from '@/lib/editor/layout';
import { fitsField, type FieldDescriptor } from '@/lib/editor/node-fields';
import { connectOutput } from '@/lib/editor/node-ops';
import { nodeTypeLabel } from '@/lib/editor/node-types';

function ReadonlyField({ descriptor, value, pointer }: { descriptor: FieldDescriptor; value: unknown; pointer: string }) {
  let shown = asText(value);
  if (pointer.endsWith('/type')) shown = nodeTypeLabel(value);
  if (pointer.endsWith('/position')) {
    const position = validPosition(value);
    shown = position !== null ? `${position.x}, ${position.y}` : value === undefined ? 'automática' : `no válida (${asText(value)})`;
  }
  return (
    <FieldBox label={descriptor.label}>
      <p className="rounded-md bg-foreground/5 px-2 py-1.5 text-sm [overflow-wrap:anywhere]">{shown}</p>
    </FieldBox>
  );
}

/**
 * Un campo del inspector o del panel del flujo, según la clase de su descriptor. Antes de pintar cualquier campo, también los
 * anidados, consulta `fitsField`: si el valor del flujo no encaja en la clase, el campo pasa a JSON libre con su nota (D8).
 * Nunca pinta `[object Object]`.
 */
export function InspectorField({ descriptor, pointer, ctx }: { descriptor: FieldDescriptor; pointer: string; ctx: FieldContext }) {
  const value = getIn(ctx.flow, pointer);
  if (descriptor.cls !== 'readonly' && !fitsField(descriptor, value)) return <JsonField descriptor={descriptor} pointer={pointer} value={value} ctx={ctx} note={SHAPE_NOTE} />;
  const props = { descriptor, pointer, value, ctx };
  switch (descriptor.cls) {
    case 'readonly':
      return <ReadonlyField descriptor={descriptor} value={value} pointer={pointer} />;
    case 'id':
      return <IdField {...props} />;
    case 'text':
    case 'template':
      return <TextField {...props} />;
    case 'number':
    case 'integer':
      return <NumberField {...props} />;
    case 'enum':
      return <EnumField {...props} />;
    case 'boolean':
      return <BooleanField {...props} />;
    case 'target':
      return (
        <TargetField
          {...props}
          allowNone={descriptor.key !== 'start'}
          onPick={(id) => {
            if (ctx.nodeId === null) ctx.edit(writeTarget(pointer, id));
            else ctx.edit((draft) => connectOutput(draft, ctx.positions, ctx.nodeId!, pointer.slice(ctx.nodeBase.length), id));
          }}
        />
      );
    case 'content':
      return <ContentField {...props} />;
    case 'value':
      return <ValueField {...props} />;
    case 'json':
      return <JsonField {...props} />;
    case 'predicate':
      return <PredicateField {...props} />;
    case 'headers':
      return <HeadersField {...props} />;
    case 'list':
      return <ListField {...props} />;
    case 'object':
      return (
        <fieldset className="flex min-w-0 flex-col gap-2 rounded-md border border-foreground/20 p-2">
          <legend className="px-1 text-sm font-medium">{descriptor.label}</legend>
          {(descriptor.fields ?? []).map((field) => (
            <InspectorField key={field.key} descriptor={field} pointer={`${pointer}/${field.key}`} ctx={ctx} />
          ))}
        </fieldset>
      );
  }
}
