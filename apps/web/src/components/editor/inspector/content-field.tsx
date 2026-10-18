import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import { SHAPE_NOTE, JsonField } from '@/components/editor/inspector/json-field';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { Button } from '@/components/ui/button';
import { addItem, removeItem, setContentKind, writeText } from '@/lib/editor/fields';
import { fitsField, type FieldDescriptor } from '@/lib/editor/node-fields';
import { isRecord } from '@/lib/editor/json-edit';
import { asText } from '@/lib/editor/as-text';

const KINDS: [string, string][] = [
  ['text', 'Texto'],
  ['image', 'Imagen'],
  ['video', 'Vídeo'],
  ['audio', 'Audio'],
  ['embed', 'Contenido incrustado'],
];

function ContentItem({ descriptor, pointer, item, index, ctx }: { descriptor: FieldDescriptor; pointer: string; item: unknown; index: number; ctx: FieldContext }) {
  const meta = useFieldMeta(ctx, pointer);
  const record = isRecord(item) ? item : {};
  const kind = asText(record.kind);
  const isText = kind === 'text';
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-md border border-foreground/20 p-2">
      <legend className="px-1 text-xs opacity-70">
        {descriptor.label}: elemento {index + 1}
      </legend>
      <FieldBox label="Clase" htmlFor={`${meta.id}-kind`}>
        <select id={`${meta.id}-kind`} value={kind} className={CONTROL_CLASS} onChange={(event) => ctx.edit(setContentKind(pointer, event.target.value))}>
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </FieldBox>
      {isText ? (
        <FieldBox label="Texto" htmlFor={`${meta.id}-text`}>
          <textarea id={`${meta.id}-text`} rows={3} value={asText(record.text)} className={CONTROL_CLASS} onChange={(event) => ctx.edit(writeText(`${pointer}/text`, event.target.value, true))} />
        </FieldBox>
      ) : (
        <>
          {/* La URL es texto: no se carga, no se enlaza ni se incrusta (D19). */}
          <FieldBox label="URL (solo texto, no se carga)" htmlFor={`${meta.id}-url`}>
            <input id={`${meta.id}-url`} type="text" value={asText(record.url)} className={CONTROL_CLASS} onChange={(event) => ctx.edit(writeText(`${pointer}/url`, event.target.value, true))} />
          </FieldBox>
          <FieldBox label="Texto alternativo" htmlFor={`${meta.id}-alt`}>
            <input id={`${meta.id}-alt`} type="text" value={asText(record.alt)} className={CONTROL_CLASS} onChange={(event) => ctx.edit(writeText(`${pointer}/alt`, event.target.value, false))} />
          </FieldBox>
        </>
      )}
      <Button variant="secondary" aria-label={`Quitar ${descriptor.label.toLowerCase()} ${index + 1}`} className="self-start" onClick={() => {
          ctx.edit(removeItem(pointer));
          ctx.focusInspector();
        }}>
        Quitar elemento
      </Button>
    </fieldset>
  );
}

/** Contenido de un mensaje, una pregunta o un fin: texto y multimedia. Las URLs son campos de texto (nada se carga). */
export function ContentField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const meta = useFieldMeta(ctx, pointer, null, true);
  if (!fitsField(descriptor, value)) return <JsonField descriptor={descriptor} pointer={pointer} value={value} ctx={ctx} note={SHAPE_NOTE} />;
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={meta.describedBy}>
      <legend className="text-sm font-medium">{descriptor.label}</legend>
      {items.map((item, index) => (
        <ContentItem key={index} descriptor={descriptor} pointer={`${pointer}/${index}`} item={item} index={index} ctx={ctx} />
      ))}
      <Button variant="secondary" className="self-start" aria-label={`Añadir elemento a ${descriptor.label.toLowerCase()}`} onClick={() => ctx.edit(addItem(pointer, descriptor))}>
        Añadir elemento
      </Button>
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} errorId={meta.errorId} />
    </fieldset>
  );
}
