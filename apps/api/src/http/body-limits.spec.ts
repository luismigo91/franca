import { describe, expect, it } from 'vitest';
import { payloadTooLarge } from './api-error.js';
import { toErrorResponse } from './api-exception.filter.js';
import { bodyLimitFor, MAX_CONVERSATION_BODY_BYTES } from './body-limits.js';
import { MAX_BODY_BYTES } from './limits.js';

describe('bodyLimitFor', () => {
  it('64 KiB en las dos rutas POST de conversaciones', () => {
    expect(MAX_CONVERSATION_BODY_BYTES).toBe(65_536);
    expect(bodyLimitFor('POST', '/conversations')).toBe(65_536);
    expect(bodyLimitFor('POST', '/conversations/4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90/inputs')).toBe(65_536);
  });

  it.each(['/CONVERSATIONS', '/Conversations', '/conversations/', '/conversations/abc/INPUTS', '/Conversations/x/Inputs/', '/conversations/no-es-un-uuid/inputs'])(
    'mismo máximo con mayúsculas o barra final: %s',
    (path) => {
      expect(bodyLimitFor('POST', path)).toBe(65_536);
    },
  );

  it.each(['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('%s conserva 1 MiB', (method) => {
    expect(bodyLimitFor(method, '/conversations')).toBe(MAX_BODY_BYTES);
    expect(bodyLimitFor(method, '/conversations/x/inputs')).toBe(MAX_BODY_BYTES);
  });

  it.each([
    '/flows',
    '/flows/validate',
    '/flows/hola/versions',
    '/contacts/c-1',
    '/conversations/x',
    '/conversations/x/transcript',
    '/conversations//inputs',
    '/conversations/x/y/inputs',
    '/conversations/x/inputs/mas',
    '/conversationsx',
    '/api/conversations',
    '/',
    '',
  ])('POST %j conserva 1 MiB', (path) => {
    expect(bodyLimitFor('POST', path)).toBe(MAX_BODY_BYTES);
  });
});

describe('payloadTooLarge', () => {
  it('con 64 KiB, el cuerpo es exactamente {message, error} con el máximo en el mensaje', () => {
    const response = toErrorResponse(payloadTooLarge(65_536));
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ message: 'el cuerpo supera el tamaño máximo de 64 KiB', error: 'payload_too_large' });
    expect(Object.keys(response.body)).toEqual(['message', 'error']);
  });

  it('con 1 MiB, el error de siempre', () => {
    const response = toErrorResponse(payloadTooLarge(MAX_BODY_BYTES));
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ message: 'el cuerpo supera el tamaño máximo de 1 MiB', error: 'payload_too_large' });
    expect(Object.keys(response.body)).toEqual(['message', 'error']);
    expect(payloadTooLarge(MAX_BODY_BYTES).extra).toEqual({});
  });
});
