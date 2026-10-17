import { describe, expect, it } from 'vitest';
import { ApiException } from '../http/api-error.js';
import { isContactId, parseContactId, parseConversationId } from './conversation-params.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof ApiException ? error.code : 'otro';
  }
  return undefined;
};

describe('parseConversationId', () => {
  it('admite un UUID en minúsculas', () => {
    expect(parseConversationId('4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90')).toBe('4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90');
    expect(parseConversationId('00000000-0000-4000-8000-000000000000')).toBe('00000000-0000-4000-8000-000000000000');
  });

  it.each([
    '',
    'no-es-un-uuid',
    '4F1C2B7E-9D3A-4E8B-A1F0-6C5D2E3B4A90',
    '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a9',
    '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a900',
    '4f1c2b7e9d3a4e8ba1f06c5d2e3b4a90',
    ' 4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90',
    '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90\n',
    '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a9g',
  ])('rechaza %j con conversation_not_found', (value) => {
    expect(codeOf(() => parseConversationId(value))).toBe('conversation_not_found');
  });
});

describe('contactId', () => {
  it.each(['c-1', 'a', 'a'.repeat(64), '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90', 'A_b-9'])('admite %j', (value) => {
    expect(isContactId(value)).toBe(true);
    expect(parseContactId(value)).toBe(value);
  });

  it.each(['ana@example.com', '', 'c 1', 'a'.repeat(65), 'a.b', 'ñ', 'c-1\n', ' c-1'])('rechaza %j con invalid_request', (value) => {
    expect(isContactId(value)).toBe(false);
    expect(codeOf(() => parseContactId(value))).toBe('invalid_request');
  });

  it.each([7, null, undefined, {}, ['c-1']])('isContactId rechaza %j', (value) => {
    expect(isContactId(value)).toBe(false);
  });
});
