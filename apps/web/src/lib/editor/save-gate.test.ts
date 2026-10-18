import { validateFlow, type FlowValidationResult } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { MAX_FLOW_BYTES } from '@/lib/editor/limits';
import { checkPublishable, checkSavable, checkTryable, GATE_COPY } from '@/lib/editor/save-gate';

const valid = validateFlow(FLOWS.hola);
const invalid = validateFlow({ id: 'x' });
const withCredential = (): FlowValidationResult => {
  const flow = structuredClone(FLOWS['captacion-leads']) as FlowDoc;
  const crm = (flow.nodes as { id: string }[]).findIndex((node) => node.id === 'enviar-crm');
  (flow.nodes as { request: { headers: unknown } }[])[crm]!.request.headers = { Authorization: 'Bearer abc123' };
  return validateFlow(flow);
};

describe('checkSavable', () => {
  it('en su orden: sin cambios, inválido, credencial y tamaño', () => {
    expect(checkSavable({ dirty: false, verdict: invalid, draftText: 'x'.repeat(MAX_FLOW_BYTES + 1) })).toEqual({ ok: false, reason: 'unchanged', message: 'No hay cambios que guardar.' });
    expect(checkSavable({ dirty: true, verdict: invalid, draftText: 'x'.repeat(MAX_FLOW_BYTES + 1) })).toEqual({ ok: false, reason: 'invalid', message: 'Corrige los problemas antes de guardar.' });
    const credential = withCredential();
    expect(credential.valid).toBe(true);
    expect(checkSavable({ dirty: true, verdict: credential, draftText: 'x'.repeat(MAX_FLOW_BYTES + 1) })).toEqual({
      ok: false,
      reason: 'literal_credential',
      message: 'Hay una credencial escrita en una cabecera: usa un secreto.',
    });
    expect(checkSavable({ dirty: true, verdict: valid, draftText: 'x'.repeat(MAX_FLOW_BYTES + 1) })).toEqual({ ok: false, reason: 'too_large', message: 'El flujo supera el tamaño máximo de 1 MiB.' });
    expect(checkSavable({ dirty: true, verdict: valid, draftText: 'x'.repeat(MAX_FLOW_BYTES) })).toEqual({ ok: true });
  });

  it('el tamaño se mide en bytes UTF-8, no en caracteres (countCharsNotBytes)', () => {
    const text = 'ñ'.repeat(MAX_FLOW_BYTES / 2 + 1);
    expect(text.length).toBeLessThanOrEqual(MAX_FLOW_BYTES);
    expect(checkSavable({ dirty: true, verdict: valid, draftText: text })).toMatchObject({ ok: false, reason: 'too_large' });
    expect(checkSavable({ dirty: true, verdict: valid, draftText: 'ñ'.repeat(MAX_FLOW_BYTES / 2) })).toEqual({ ok: true });
  });

  it('una credencial en una cabecera no impide con un secreto (credential_header_not_secret no bloquea)', () => {
    const flow = structuredClone(FLOWS['captacion-leads']) as FlowDoc;
    const crm = (flow.nodes as { id: string }[]).findIndex((node) => node.id === 'enviar-crm');
    (flow.nodes as { request: { headers: unknown } }[])[crm]!.request.headers = { Authorization: 'Bearer {{nombre}}' };
    const verdict = validateFlow(flow);
    expect(verdict.warnings.map((warning) => warning.code)).toEqual(['credential_header_not_secret']);
    expect(checkSavable({ dirty: true, verdict, draftText: '{}' })).toEqual({ ok: true });
  });
});

describe('checkPublishable y checkTryable', () => {
  it('publicar solo sin cambios sin guardar', () => {
    expect(checkPublishable({ dirty: true })).toEqual({ ok: false, reason: 'unsaved_changes', message: GATE_COPY.saveBeforePublish });
    expect(checkPublishable({ dirty: false })).toEqual({ ok: true });
  });

  it('probar: sin versión primero, después sin cambios', () => {
    expect(checkTryable({ latestVersion: null, dirty: true })).toEqual({ ok: false, reason: 'no_version', message: 'Publica el flujo antes de probarlo.' });
    expect(checkTryable({ latestVersion: 1, dirty: true })).toEqual({ ok: false, reason: 'unsaved_changes', message: 'Guarda los cambios antes de probar.' });
    expect(checkTryable({ latestVersion: 1, dirty: false })).toEqual({ ok: true });
  });
});
