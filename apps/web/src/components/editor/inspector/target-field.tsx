import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { asText } from '@/lib/editor/as-text';
import type { FieldDescriptor } from '@/lib/editor/node-fields';

/**
 * Selector de salto: los nodos en el orden de `nodes` y «(ninguno)», que quita la propiedad. Un salto roto aparece como
 * «<id> (no existe)» elegido. Es la vía del teclado para todo lo que hace el arrastre.
 */
export function TargetField({
  descriptor,
  pointer,
  value,
  ctx,
  allowNone,
  onPick,
}: {
  descriptor: FieldDescriptor;
  pointer: string;
  value: unknown;
  ctx: FieldContext;
  allowNone: boolean;
  onPick: (id: string | null) => void;
}) {
  const meta = useFieldMeta(ctx, pointer);
  const current = typeof value === 'string' ? value : '';
  const missing = current !== '' && !ctx.nodeIds.includes(current);
  return (
    <FieldBox label={descriptor.label} htmlFor={meta.id}>
      <select
        id={meta.id}
        value={current}
        aria-describedby={meta.describedBy}
        className={CONTROL_CLASS}
        onChange={(event) => onPick(event.target.value === '' ? null : event.target.value)}
      >
        {allowNone && <option value="">(ninguno)</option>}
        {!allowNone && current === '' && <option value="">(sin elegir)</option>}
        {missing && <option value={current}>{asText(current)} (no existe)</option>}
        {ctx.nodeIds.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} errorId={meta.errorId} />
    </FieldBox>
  );
}
