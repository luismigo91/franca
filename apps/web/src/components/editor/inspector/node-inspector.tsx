import { InspectorField } from '@/components/editor/inspector/inspector-field';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { FieldBox } from '@/components/editor/inspector/field-shell';
import { Button } from '@/components/ui/button';
import { asText } from '@/lib/editor/as-text';
import { isRecord } from '@/lib/editor/json-edit';
import { fieldsOfType, type FieldDescriptor } from '@/lib/editor/node-fields';
import { nodeTypeLabel } from '@/lib/editor/node-types';

const UNKNOWN_BASE: FieldDescriptor[] = [
  { key: 'id', cls: 'id', label: 'Identificador', required: true },
  { key: 'type', cls: 'readonly', label: 'Tipo', required: true },
];

/** `choices` y `multiple` se muestran con `inputType` `choice` o si ya existen; el resto de campos, siempre. */
function visibleFields(fields: readonly FieldDescriptor[], node: Record<string, unknown>): FieldDescriptor[] {
  const isChoice = node.inputType === 'choice';
  return fields.filter((field) => node.type !== 'input' || (field.key !== 'choices' && field.key !== 'multiple') || isChoice || Object.hasOwn(node, field.key));
}

/** El formulario del nodo seleccionado: un campo por propiedad del esquema de su tipo (D8). */
export function NodeInspector({ ctx, index, onEditJson, onDelete }: { ctx: FieldContext; index: number; onEditJson: () => void; onDelete: () => void }) {
  const nodes: unknown[] = Array.isArray(ctx.flow.nodes) ? (ctx.flow.nodes as unknown[]) : [];
  const node = nodes[index];
  if (!isRecord(node)) return null;
  const known = fieldsOfType(node.type);
  const fields = known === null ? UNKNOWN_BASE : visibleFields(known, node);
  const id = asText(node.id);
  return (
    <section aria-labelledby="inspector-title" className="flex min-w-0 flex-col gap-3">
      <h2 id="inspector-title" tabIndex={-1} className="text-lg font-semibold [overflow-wrap:anywhere]">
        Nodo {id} · {nodeTypeLabel(node.type)}
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onEditJson}>
          Editar como JSON
        </Button>
        <Button variant="danger" aria-label={`Borrar nodo ${id}`} onClick={onDelete}>
          Borrar nodo
        </Button>
      </div>
      {known === null && (
        <FieldBox label="Tipo desconocido">
          <p className="text-sm">Usa «Editar como JSON» para este nodo.</p>
        </FieldBox>
      )}
      {fields.map((field) => (
        <InspectorField key={field.key} descriptor={field} pointer={`${ctx.nodeBase}/${field.key}`} ctx={ctx} />
      ))}
    </section>
  );
}
