import { INVALID_ANSWER_REASONS } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@/config/api-error-codes';
import { COPY, GENERIC_REASON_COPY, REASON_COPY, STATUS_COPY, errorCopy, knownCodes, reasonCopy, type ChatErrorCode, type ErrorContext } from '@/lib/chat/copy';

const CONTEXTS: ErrorContext[] = ['list', 'start', 'open', 'send', 'remove'];

describe('copy', () => {
  it('hay un aviso por cada motivo del motor, con las mismas claves, y un genérico', () => {
    expect(Object.keys(REASON_COPY).sort()).toEqual([...INVALID_ANSWER_REASONS].sort());
    for (const reason of INVALID_ANSWER_REASONS) expect(reasonCopy(reason)).toBe(REASON_COPY[reason]);
    expect(reasonCopy('motivo_nuevo')).toBe(GENERIC_REASON_COPY);
    expect(reasonCopy('constructor')).toBe(GENERIC_REASON_COPY);
    expect(reasonCopy('__proto__')).toBe(GENERIC_REASON_COPY);
    expect(new Set([...Object.values(REASON_COPY), GENERIC_REASON_COPY]).size).toBe(INVALID_ANSWER_REASONS.length + 1);
  });

  it('cada código con escenario tiene su texto en su contexto', () => {
    expect(errorCopy('start', 'flow_not_found')).toBe('Ese flujo ya no existe.');
    expect(errorCopy('start', 'flow_not_published')).toBe('Este flujo no tiene ninguna versión publicada.');
    expect(errorCopy('start', 'flow_version_invalid')).toBe('La versión publicada ya no es válida: publica una versión nueva.');
    expect(errorCopy('start', 'database_unavailable')).toBe('La base de datos de Franca no está disponible.');
    expect(errorCopy('start', 'api_unreachable')).toBe('No se puede conectar con la API de Franca.');
    expect(errorCopy('start', 'network_error')).toBe('No se puede conectar con la API de Franca.');
    expect(errorCopy('send', 'invalid_input')).toBe('La respuesta no tiene la forma que espera la pregunta.');
    expect(errorCopy('send', 'revision_mismatch')).toBe('La conversación ha avanzado en otra pestaña.');
    expect(errorCopy('send', 'conversation_busy')).toBe('La conversación está procesando otra respuesta.');
    expect(errorCopy('send', 'conversation_not_found')).toBe('Esta conversación ya no existe.');
    expect(errorCopy('send', 'payload_too_large')).toBe('La respuesta es demasiado larga para enviarla.');
    expect(errorCopy('list', 'api_unreachable')).toBe('No se puede conectar con la API de Franca.');
    expect(errorCopy('remove', 'network_error')).toBe('No se puede conectar con la API de Franca.');
    expect(errorCopy('remove', 'unknown')).toBe('No se ha podido borrar la conversación.');
  });

  it('un código desconocido, unknown o uno sin texto en el contexto da el genérico de ese contexto', () => {
    for (const context of CONTEXTS) {
      const generic = errorCopy(context, 'unknown');
      expect(errorCopy(context, 'codigo_nuevo' as ChatErrorCode)).toBe(generic);
      expect(errorCopy(context, 'constructor' as ChatErrorCode)).toBe(generic);
      expect(errorCopy(context, '__proto__' as ChatErrorCode)).toBe(generic);
      expect(generic.length).toBeGreaterThan(10);
    }
  });

  it('los códigos con texto propio son códigos conocidos', () => {
    const known: readonly string[] = [...API_ERROR_CODES, 'api_unreachable', 'invalid_api_response', 'network_error'];
    for (const context of CONTEXTS) for (const code of knownCodes(context)) expect(known, `${context}/${code}`).toContain(code);
  });

  it('los estados salen en español', () => {
    expect(STATUS_COPY).toEqual({ waiting: 'En espera', ended: 'Terminada', failed: 'Fallida', expired: 'Caducada' });
  });

  it('ningún texto contiene @franca/ ni el nombre del repo', () => {
    const all = [
      ...Object.values(REASON_COPY),
      GENERIC_REASON_COPY,
      ...Object.values(STATUS_COPY),
      ...Object.values(COPY),
      ...CONTEXTS.flatMap((context) => [errorCopy(context, 'unknown'), ...knownCodes(context).map((code) => errorCopy(context, code as ChatErrorCode))]),
    ];
    for (const text of all) {
      expect(text).not.toContain('@franca/');
      expect(text).not.toContain('franca-web');
    }
    expect(COPY.brand).toBe('Franca');
  });
});
