'use client';

import { useState } from 'react';
import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { Button } from '@/components/ui/button';
import { addHeader, removeHeader, renameHeader, writeHeader, type HeaderMode } from '@/lib/editor/fields';
import { isRecord, pointerOf } from '@/lib/editor/json-edit';
import type { FieldDescriptor } from '@/lib/editor/node-fields';

const SECRET_LABEL = 'Nombre del secreto, en mayúsculas';

function modeOf(value: unknown): HeaderMode {
  return isRecord(value) ? 'secret' : 'text';
}

function valueOf(value: unknown): string {
  if (isRecord(value)) return typeof value.secret === 'string' ? value.secret : '';
  return typeof value === 'string' ? value : '';
}

function HeaderRow({ headersPointer, name, value, ctx }: { headersPointer: string; name: string; value: unknown; ctx: FieldContext }) {
  const [typedName, setTypedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pointer = `${headersPointer}${pointerOf([name])}`;
  const meta = useFieldMeta(ctx, pointer, error);
  const mode = modeOf(value);
  const commitName = () => {
    if (typedName === null) return;
    const result = ctx.edit(renameHeader(headersPointer, name, typedName));
    setError(result.ok ? null : result.error);
    if (result.ok) setTypedName(null);
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-md border border-foreground/20 p-2" aria-describedby={meta.describedBy}>
      <legend className="px-1 text-xs opacity-70">Cabecera {name}</legend>
      <FieldBox label="Nombre" htmlFor={`${meta.id}-name`}>
        <input
          id={`${meta.id}-name`}
          type="text"
          value={typedName ?? name}
          className={CONTROL_CLASS}
          aria-invalid={error !== null || undefined}
          onChange={(event) => setTypedName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitName();
            }
          }}
        />
      </FieldBox>
      <FieldBox label="Tipo" htmlFor={`${meta.id}-mode`}>
        <select id={`${meta.id}-mode`} value={mode} className={CONTROL_CLASS} onChange={(event) => ctx.edit(writeHeader(headersPointer, name, event.target.value as HeaderMode, ''))}>
          <option value="text">Texto</option>
          <option value="secret">Secreto</option>
        </select>
      </FieldBox>
      <FieldBox label={mode === 'secret' ? SECRET_LABEL : 'Valor'} htmlFor={`${meta.id}-value`}>
        <input id={`${meta.id}-value`} type="text" value={valueOf(value)} className={CONTROL_CLASS} onChange={(event) => ctx.edit(writeHeader(headersPointer, name, mode, event.target.value))} />
      </FieldBox>
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} error={error} errorId={meta.errorId} />
      <Button variant="secondary" className="self-start" aria-label={`Quitar la cabecera ${name}`} onClick={() => ctx.edit(removeHeader(headersPointer, name))}>
        Quitar cabecera
      </Button>
    </fieldset>
  );
}

/**
 * Cabeceras de una petición: cada una como texto o como secreto por nombre (`{"secret": "NOMBRE"}`). Una cabecera nueva
 * se escribe con un mini formulario y se añade al final, así nunca hay una clave a medias en el JSON.
 */
export function HeadersField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<HeaderMode>('text');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const meta = useFieldMeta(ctx, pointer, error, true);
  const entries = isRecord(value) ? Object.entries(value) : [];
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={meta.describedBy}>
      <legend className="text-sm font-medium">{descriptor.label}</legend>
      {entries.map(([headerName, headerValue]) => (
        <HeaderRow key={headerName} headersPointer={pointer} name={headerName} value={headerValue} ctx={ctx} />
      ))}
      <div className="flex min-w-0 flex-col gap-2 rounded-md border border-dashed border-foreground/30 p-2">
        <p className="text-xs opacity-70">Nueva cabecera</p>
        <FieldBox label="Nombre de la cabecera" htmlFor={`${meta.id}-new-name`}>
          <input id={`${meta.id}-new-name`} type="text" value={name} className={CONTROL_CLASS} onChange={(event) => setName(event.target.value)} />
        </FieldBox>
        <FieldBox label="Tipo de la cabecera" htmlFor={`${meta.id}-new-mode`}>
          <select id={`${meta.id}-new-mode`} value={mode} className={CONTROL_CLASS} onChange={(event) => setMode(event.target.value as HeaderMode)}>
            <option value="text">Texto</option>
            <option value="secret">Secreto</option>
          </select>
        </FieldBox>
        <FieldBox label={mode === 'secret' ? SECRET_LABEL : 'Valor de la cabecera'} htmlFor={`${meta.id}-new-value`}>
          <input id={`${meta.id}-new-value`} type="text" value={content} className={CONTROL_CLASS} onChange={(event) => setContent(event.target.value)} />
        </FieldBox>
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            const result = ctx.edit(addHeader(pointer, name, mode, content));
            setError(result.ok ? null : result.error);
            if (!result.ok) return;
            setName('');
            setContent('');
          }}
        >
          Añadir cabecera
        </Button>
      </div>
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} error={error} errorId={meta.errorId} />
    </fieldset>
  );
}
