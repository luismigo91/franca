'use client';

import { useState } from 'react';
import { CONTROL_CLASS, FieldBox, FieldMessages, useFieldMeta } from '@/components/editor/inspector/field-shell';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { asText } from '@/lib/editor/as-text';
import { modeOfValue, writeValue } from '@/lib/editor/fields';
import type { FieldDescriptor, ValueMode } from '@/lib/editor/node-fields';

const MODE_LABELS: Record<ValueMode | 'none', string> = {
  none: '(ninguno)',
  string: 'Texto',
  number: 'Número',
  boolean: 'Sí/no',
  null: 'Nulo',
  json: 'JSON',
};

/** Lo que se escribe al cambiar de modo: un valor del modo nuevo (JSON conserva el actual). */
function starting(mode: ValueMode | 'none', value: unknown): { mode: ValueMode | 'none'; raw: string } {
  switch (mode) {
    case 'string':
      return { mode, raw: typeof value === 'string' ? value : '' };
    case 'number':
      return { mode, raw: typeof value === 'number' ? String(value) : '0' };
    case 'boolean':
      return { mode, raw: String(value === true) };
    case 'json':
      return { mode, raw: value === undefined ? 'null' : (JSON.stringify(value) ?? 'null') };
    default:
      return { mode, raw: '' };
  }
}

/**
 * Valor (`value` de `set`, de opciones y de reglas, y `default`): se escribe como texto, número, sí/no, nulo o JSON, según
 * admita el esquema. Un número mal escrito o un JSON inválido se conservan en el campo y no se escriben.
 */
export function ValueField({ descriptor, pointer, value, ctx }: { descriptor: FieldDescriptor; pointer: string; value: unknown; ctx: FieldContext }) {
  const modes: (ValueMode | 'none')[] = [...(descriptor.required === true ? [] : (['none'] as const)), ...(descriptor.valueModes ?? ['string'])];
  const [picked, setPicked] = useState<ValueMode | 'none' | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta = useFieldMeta(ctx, pointer, error);
  const mode = picked ?? modeOfValue(value);
  const raw = typed ?? (mode === 'json' ? (value === undefined ? '' : (JSON.stringify(value, null, 2) ?? '')) : mode === 'string' || mode === 'number' ? asText(value) : '');

  const apply = (nextMode: ValueMode | 'none', text: string) => {
    const result = ctx.edit(writeValue(pointer, nextMode, text));
    setError(result.ok ? null : result.error);
  };

  return (
    <FieldBox label={descriptor.label}>
      <div className="flex min-w-0 flex-wrap gap-2">
        <select
          aria-label={`${descriptor.label}: tipo de valor`}
          value={mode}
          className={`${CONTROL_CLASS} w-auto`}
          onChange={(event) => {
            const next = starting(event.target.value as ValueMode | 'none', value);
            setPicked(next.mode);
            setTyped(null);
            apply(next.mode, next.raw);
          }}
        >
          {modes.map((option) => (
            <option key={option} value={option}>
              {MODE_LABELS[option]}
            </option>
          ))}
        </select>
        {(mode === 'string' || mode === 'number') && (
          <input
            id={meta.id}
            type="text"
            aria-label={`${descriptor.label}: valor`}
            value={raw}
            aria-describedby={meta.describedBy}
            aria-invalid={error !== null || undefined}
            className={`${CONTROL_CLASS} flex-1`}
            onChange={(event) => {
              setTyped(event.target.value);
              apply(mode, event.target.value);
            }}
            onBlur={() => setTyped(null)}
          />
        )}
        {mode === 'boolean' && (
          <select aria-label={`${descriptor.label}: valor`} value={String(value === true)} className={`${CONTROL_CLASS} w-auto`} onChange={(event) => apply('boolean', event.target.value)}>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        )}
        {mode === 'json' && (
          <textarea
            id={meta.id}
            rows={3}
            spellCheck={false}
            aria-label={`${descriptor.label}: valor JSON`}
            value={raw}
            aria-describedby={meta.describedBy}
            aria-invalid={error !== null || undefined}
            className={`${CONTROL_CLASS} flex-1 font-mono`}
            onChange={(event) => {
              setTyped(event.target.value);
              apply('json', event.target.value);
            }}
            onBlur={() => setTyped(null)}
          />
        )}
      </div>
      <FieldMessages problems={meta.problems} problemsId={meta.problemsId} error={error} errorId={meta.errorId} />
    </FieldBox>
  );
}
