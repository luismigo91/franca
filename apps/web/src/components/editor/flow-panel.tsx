import { InspectorField } from '@/components/editor/inspector/inspector-field';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { FLOW_FIELDS } from '@/lib/editor/node-fields';

/** El panel del flujo: nombre, descripción, `locale`, `settings`, `start` y variables; `id` y `specVersion` solo se muestran. */
export function FlowPanel({ ctx }: { ctx: FieldContext }) {
  return (
    <section aria-labelledby="inspector-title" className="flex min-w-0 flex-col gap-3">
      <h2 id="inspector-title" tabIndex={-1} className="text-lg font-semibold">
        Propiedades del flujo
      </h2>
      {FLOW_FIELDS.map((field) => (
        <InspectorField key={field.key} descriptor={field} pointer={`/${field.key}`} ctx={ctx} />
      ))}
    </section>
  );
}
