import { afterEach, describe, expect, it, vi } from 'vitest';
import { logInvalidApiUrl, logServerError } from '@/server/log';

afterEach(() => vi.restoreAllMocks());

describe('log', () => {
  it('escribe método, plantilla, estado y código, y la clase del error si la hay', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logServerError('POST', '/api/conversations/[conversationId]/inputs', 502, 'api_unreachable');
    logServerError('GET', '/api/flows', 500, 'internal_error', 'ApiUrlError');
    expect(spy.mock.calls).toEqual([
      ['[web] POST /api/conversations/[conversationId]/inputs 502 api_unreachable'],
      ['[web] GET /api/flows 500 internal_error ApiUrlError'],
    ]);
  });

  it('la línea usa la plantilla y no puede llevar la ruta real ni datos de la conversación', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logServerError('DELETE', '/api/conversations/[conversationId]', 500, 'internal_error');
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(line.split(' ')).toHaveLength(5);
  });

  it('la configuración inválida nombra la variable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logInvalidApiUrl();
    expect(String(spy.mock.calls[0]?.[0])).toContain('FRANCA_API_URL');
  });
});
