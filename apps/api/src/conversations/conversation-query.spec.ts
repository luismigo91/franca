import { describe, expect, it } from 'vitest';
import { ApiException } from '../http/api-error.js';
import { parseConversationListQuery } from './conversation-query.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof ApiException ? error.code : 'otro';
  }
  return undefined;
};

describe('parseConversationListQuery', () => {
  it('sin parámetros: límite 20, desplazamiento 0', () => {
    expect(parseConversationListQuery({})).toEqual({ limit: 20, offset: 0 });
  });

  it('flowId, status, limit y offset', () => {
    expect(parseConversationListQuery({ flowId: 'hola', status: 'ended', limit: '5', offset: '10' })).toEqual({ flowId: 'hola', status: 'ended', limit: 5, offset: 10 });
  });

  it.each(['waiting', 'ended', 'failed', 'expired'])('admite status %s', (status) => {
    expect(parseConversationListQuery({ status }).status).toBe(status);
  });

  it('los parámetros desconocidos se ignoran, published incluido', () => {
    expect(parseConversationListQuery({ orden: 'fecha', published: 'maybe' })).toEqual({ limit: 20, offset: 0 });
  });

  it.each([
    [{ status: 'activa' }],
    [{ status: '' }],
    [{ status: ['ended', 'failed'] }],
    [{ flowId: 'Hola' }],
    [{ flowId: '' }],
    [{ flowId: ['hola', 'pregunta'] }],
    [{ limit: '101' }],
    [{ limit: '0' }],
    [{ limit: ['1', '2'] }],
    [{ offset: '-1' }],
    [{ offset: '2147483648' }],
    [{ offset: 'x' }],
  ])('rechaza %j con invalid_query', (query) => {
    expect(codeOf(() => parseConversationListQuery(query))).toBe('invalid_query');
  });

  it('admite offset 2147483647', () => {
    expect(parseConversationListQuery({ offset: '2147483647' }).offset).toBe(2_147_483_647);
  });
});
