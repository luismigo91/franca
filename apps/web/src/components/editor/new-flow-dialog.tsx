'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { CONTROL_CLASS } from '@/components/editor/inspector/field-shell';
import { useModalDialog } from '@/components/editor/use-modal-dialog';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { WEB_PAGES } from '@/config/endpoints';
import { editorErrorCopy } from '@/lib/editor/copy';
import { emptyFlow } from '@/lib/editor/node-templates';
import { ID_PATTERN_ERROR } from '@/lib/editor/rename';
import { GATE_COPY } from '@/lib/editor/save-gate';
import { validateDraft } from '@/lib/editor/validate-draft';
import { editorClient } from '@/lib/web-client';

type Mode = 'empty' | 'json';

interface Issue {
  message: string;
  path: string;
}

export const NAME_ERROR = 'El nombre es obligatorio y tiene como mucho 120 caracteres.';

/**
 * «Nuevo flujo» (D16): un flujo vacío (identificador y nombre) o uno desde un JSON pegado. Se valida con `validateFlow`
 * antes de enviar; si no es válido, el campo culpable lo indica, recibe el foco y no se envía nada. Un id en uso (409) se
 * queda en el diálogo con lo escrito.
 */
export function NewFlowDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useModalDialog(open);
  const router = useRouter();
  const uid = useId();
  const idInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>('empty');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const [idError, setIdError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Cada vez que se abre, parte de cero (se ajusta durante el render, sin efecto).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode('empty');
      setId('');
      setName('');
      setJson('');
      setIdError(null);
      setNameError(null);
      setJsonError(null);
      setIssues([]);
      setNotice(null);
      setCreating(false);
    }
  }

  const clearErrors = () => {
    setIdError(null);
    setNameError(null);
    setJsonError(null);
    setIssues([]);
    setNotice(null);
  };

  /** Valida lo escrito y devuelve el texto JSON que se enviaría, o `null` (con el motivo ya mostrado y el foco puesto). */
  const prepare = (): string | null => {
    if (mode === 'empty') {
      const flow = emptyFlow(id, name);
      const verdict = validateDraft(flow);
      if (verdict.valid) return JSON.stringify(flow);
      const paths = verdict.issues.map((issue) => issue.path);
      if (paths.includes('/id')) {
        setIdError(ID_PATTERN_ERROR);
        idInput.current?.focus();
      }
      if (paths.includes('/name')) {
        setNameError(NAME_ERROR);
        if (!paths.includes('/id')) nameInput.current?.focus();
      }
      if (!paths.includes('/id') && !paths.includes('/name')) setNotice('No se puede crear un flujo con esos datos.');
      return null;
    }
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      setJsonError('El texto no es JSON.');
      jsonInput.current?.focus();
      return null;
    }
    const verdict = validateDraft(value);
    if (!verdict.valid) {
      setJsonError('El flujo no es válido:');
      setIssues(verdict.issues.map((issue) => ({ message: issue.message, path: issue.path })));
      jsonInput.current?.focus();
      return null;
    }
    if (verdict.warnings.some((warning) => warning.code === 'credential_header_literal')) {
      setJsonError(GATE_COPY.literalCredential);
      jsonInput.current?.focus();
      return null;
    }
    return JSON.stringify(value);
  };

  const submit = async () => {
    if (creating) return;
    clearErrors();
    const text = prepare();
    if (text === null) return;
    setCreating(true);
    const result = await editorClient.createFlow(text);
    setCreating(false);
    if (result.ok) {
      onClose();
      router.push(WEB_PAGES.flowEditor(result.body.id));
      return;
    }
    const message = editorErrorCopy('create', result.code);
    if (result.code === 'flow_already_exists' || result.code === 'flow_id_reserved') {
      if (mode === 'empty') {
        setIdError(message);
        idInput.current?.focus();
      } else {
        setJsonError(message);
        jsonInput.current?.focus();
      }
      return;
    }
    setNotice(message);
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby={`${uid}-title`}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-foreground/30 bg-background p-5 text-foreground overscroll-contain backdrop:bg-black/50"
    >
      <h2 id={`${uid}-title`} className="text-lg font-semibold">
        Nuevo flujo
      </h2>
      <form
        noValidate
        className="mt-3 flex min-w-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 text-sm font-medium">Cómo crearlo</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={`${uid}-mode`} checked={mode === 'empty'} onChange={() => setMode('empty')} />
            Vacío
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={`${uid}-mode`} checked={mode === 'json'} onChange={() => setMode('json')} />
            Desde JSON
          </label>
        </fieldset>
        {mode === 'empty' ? (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-id`} className="text-sm font-medium">
                Identificador
              </label>
              <input
                id={`${uid}-id`}
                ref={idInput}
                type="text"
                spellCheck={false}
                autoComplete="off"
                value={id}
                aria-invalid={idError !== null || undefined}
                aria-describedby={idError === null ? undefined : `${uid}-id-error`}
                className={CONTROL_CLASS}
                onChange={(event) => setId(event.target.value)}
              />
              {idError !== null && (
                <p id={`${uid}-id-error`} role="alert" className="text-xs text-red-700 dark:text-red-400">
                  {idError}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-name`} className="text-sm font-medium">
                Nombre
              </label>
              <input
                id={`${uid}-name`}
                ref={nameInput}
                type="text"
                autoComplete="off"
                value={name}
                aria-invalid={nameError !== null || undefined}
                aria-describedby={nameError === null ? undefined : `${uid}-name-error`}
                className={CONTROL_CLASS}
                onChange={(event) => setName(event.target.value)}
              />
              {nameError !== null && (
                <p id={`${uid}-name-error`} role="alert" className="text-xs text-red-700 dark:text-red-400">
                  {nameError}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-json`} className="text-sm font-medium">
              JSON del flujo
            </label>
            {jsonError !== null && (
              <div id={`${uid}-json-error`} role="alert" className="text-sm text-red-700 dark:text-red-400">
                <p>{jsonError}</p>
                {issues.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {issues.map((issue, index) => (
                      <li key={index}>
                        {issue.message}
                        {issue.path !== '' && <span className="opacity-70"> ({issue.path})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <textarea
              id={`${uid}-json`}
              ref={jsonInput}
              rows={10}
              spellCheck={false}
              value={json}
              aria-invalid={jsonError !== null || undefined}
              aria-describedby={jsonError === null ? undefined : `${uid}-json-error`}
              className={`${CONTROL_CLASS} font-mono text-xs`}
              onChange={(event) => setJson(event.target.value)}
            />
          </div>
        )}
        {notice !== null && <Notice tone="error">{notice}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" aria-disabled={creating || undefined}>
            {creating ? 'Creando…' : 'Crear'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
