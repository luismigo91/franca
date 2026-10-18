import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@/config/api-error-codes';
import { WEB_ERROR_CODES } from '@/config/web-error-codes';
import type { ChatErrorCode } from '@/lib/chat/copy';
import { EDITOR_COPY, editorErrorCopy, editorKnownCodes, type EditorErrorContext } from '@/lib/editor/copy';
import { GATE_COPY } from '@/lib/editor/save-gate';
import { ID_PATTERN_ERROR } from '@/lib/editor/rename';

const CONTEXTS: EditorErrorContext[] = ['create', 'open', 'save', 'publish', 'delete'];
const ALL_CODES: ChatErrorCode[] = [...API_ERROR_CODES, ...WEB_ERROR_CODES, 'network_error', 'unknown'];

describe('textos del editor', () => {
  it('cada código con escenario tiene su texto propio', () => {
    const expected: [EditorErrorContext, ChatErrorCode, string][] = [
      ['create', 'flow_already_exists', 'Ya existe un flujo con ese identificador.'],
      ['create', 'flow_id_reserved', 'Ese identificador perteneció a un flujo borrado y no se puede reutilizar.'],
      ['create', 'invalid_flow', 'La API de Franca considera que el flujo no es válido.'],
      ['create', 'payload_too_large', 'El flujo supera el tamaño máximo de 1 MiB.'],
      ['save', 'flow_not_found', 'El flujo se ha borrado fuera del editor. Usa «Ver JSON» para copiar lo que has editado.'],
      ['save', 'literal_credential', 'La API de Franca no guarda credenciales escritas: usa un secreto.'],
      ['save', 'database_unavailable', 'La base de datos de Franca no está disponible.'],
      ['publish', 'revision_mismatch', 'El flujo ha cambiado fuera del editor.'],
      ['delete', 'revision_mismatch', 'El flujo ha cambiado fuera del editor.'],
      ['open', 'api_unreachable', 'No se puede conectar con la API de Franca.'],
      ['open', 'network_error', 'No se puede conectar con la API de Franca.'],
    ];
    for (const [context, code, text] of expected) expect(editorErrorCopy(context, code), `${context}/${code}`).toBe(text);
  });

  it('un código sin texto propio, o unknown, da el genérico del contexto', () => {
    expect(editorErrorCopy('save', 'unknown')).toBe('No se ha podido guardar el flujo.');
    expect(editorErrorCopy('publish', 'flow_id_mismatch')).toBe('No se ha podido publicar el flujo.');
    expect(editorErrorCopy('delete', 'precondition_required')).toBe('No se ha podido borrar el flujo.');
    expect(editorErrorCopy('create', 'invalid_request')).toBe('No se ha podido crear el flujo.');
    expect(editorErrorCopy('open', 'internal_error')).toBe('No se ha podido cargar el flujo.');
    expect(editorErrorCopy('save', 'constructor' as ChatErrorCode)).toBe('No se ha podido guardar el flujo.');
  });

  it('los códigos con texto propio existen de verdad', () => {
    for (const context of CONTEXTS) for (const code of editorKnownCodes(context)) expect(ALL_CODES, `${context}/${code}`).toContain(code);
  });

  it('ningún texto contiene @franca/ ni franca-web, ni el message de una API', () => {
    const texts = [
      ...CONTEXTS.flatMap((context) => ALL_CODES.map((code) => editorErrorCopy(context, code))),
      ...Object.values(GATE_COPY),
      ID_PATTERN_ERROR,
      EDITOR_COPY.conflict,
      EDITOR_COPY.changedOutside,
      EDITOR_COPY.gone,
      EDITOR_COPY.unconfirmed,
      EDITOR_COPY.unconfirmedDatabase,
      EDITOR_COPY.saved(2),
      EDITOR_COPY.published(1),
      EDITOR_COPY.alreadyPublished(1),
      EDITOR_COPY.copied,
      EDITOR_COPY.selfJump,
    ];
    for (const text of texts) {
      expect(text).not.toContain('@franca/');
      expect(text).not.toContain('franca-web');
    }
  });

  it('los anuncios', () => {
    expect(EDITOR_COPY.saved(2)).toBe('Guardado. Revisión 2.');
    expect(EDITOR_COPY.published(3)).toBe('Publicada la versión 3.');
    expect(EDITOR_COPY.alreadyPublished(1)).toBe('La versión 1 ya tiene este borrador.');
  });
});
