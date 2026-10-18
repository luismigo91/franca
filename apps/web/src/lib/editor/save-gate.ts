import type { FlowValidationResult } from '@franca/spec';
import { MAX_FLOW_BYTES } from '@/lib/editor/limits';
import { utf8Bytes } from '@/lib/editor/flow-text';

export type GateReason = 'unchanged' | 'invalid' | 'literal_credential' | 'too_large' | 'unsaved_changes' | 'no_version';

/** Resultado de una barrera local: si pasa, o por qué no (con su texto en español). */
export type Gate = { ok: true } | { ok: false; reason: GateReason; message: string };

export const GATE_COPY = {
  unchanged: 'No hay cambios que guardar.',
  invalid: 'Corrige los problemas antes de guardar.',
  literalCredential: 'Hay una credencial escrita en una cabecera: usa un secreto.',
  tooLarge: 'El flujo supera el tamaño máximo de 1 MiB.',
  saveBeforePublish: 'Guarda los cambios antes de publicar.',
  publishBeforeTry: 'Publica el flujo antes de probarlo.',
  saveBeforeTry: 'Guarda los cambios antes de probar.',
} as const;

const blocked = (reason: GateReason, message: string): Gate => ({ ok: false, reason, message });

/**
 * Barreras de «Guardar», en su orden: sin cambios, inválido, credencial escrita (con la lista **completa** de avisos) y
 * tamaño en bytes UTF-8. Si alguna salta, no se envía nada.
 *
 * @param state Si hay cambios, el veredicto de `validateFlow` y el texto que se enviaría.
 */
export function checkSavable(state: { dirty: boolean; verdict: FlowValidationResult; draftText: string }): Gate {
  if (!state.dirty) return blocked('unchanged', GATE_COPY.unchanged);
  if (!state.verdict.valid) return blocked('invalid', GATE_COPY.invalid);
  if (state.verdict.warnings.some((warning) => warning.code === 'credential_header_literal')) return blocked('literal_credential', GATE_COPY.literalCredential);
  if (utf8Bytes(state.draftText) > MAX_FLOW_BYTES) return blocked('too_large', GATE_COPY.tooLarge);
  return { ok: true };
}

/** «Publicar» solo sin cambios sin guardar. */
export function checkPublishable(state: { dirty: boolean }): Gate {
  return state.dirty ? blocked('unsaved_changes', GATE_COPY.saveBeforePublish) : { ok: true };
}

/** «Probar» solo con alguna versión publicada y sin cambios sin guardar (en ese orden). */
export function checkTryable(state: { latestVersion: number | null; dirty: boolean }): Gate {
  if (state.latestVersion === null) return blocked('no_version', GATE_COPY.publishBeforeTry);
  if (state.dirty) return blocked('unsaved_changes', GATE_COPY.saveBeforeTry);
  return { ok: true };
}
