import { describe, expect, it } from 'vitest';
import schema from '@franca/spec/flow.schema.json';
import { isConversationId, isFlowId, parseOffset, parseVersion } from '@/server/ids';

describe('ids', () => {
  it('acepta un UUID en minúsculas', () => {
    expect(isConversationId('4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90')).toBe(true);
    expect(isConversationId('00000000-0000-4000-8000-000000000000')).toBe(true);
  });

  it.each([
    '00000000-0000-4000-8000-00000000000A',
    '..%2F..%2Fflows%2Fhola',
    '../../flows/hola',
    'no-es-un-uuid',
    '',
    '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90/',
    '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90\n',
    ' 4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90',
  ])('rechaza %j como id de conversación', (value) => {
    expect(isConversationId(value)).toBe(false);
  });

  it('rechaza lo que no es texto', () => {
    expect(isConversationId(undefined)).toBe(false);
    expect(isConversationId(null)).toBe(false);
    expect(isConversationId(12)).toBe(false);
    expect(isConversationId(['4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90'])).toBe(false);
  });

  it('el patrón del id de flujo es el del esquema de @franca/spec', () => {
    const pattern = new RegExp(schema.$defs.id.pattern);
    for (const candidate of ['captacion-leads', 'faq-ia', 'a', 'A', '1a', 'a b', '../x', '', 'a'.repeat(64), 'a'.repeat(65)]) {
      expect(isFlowId(candidate), candidate).toBe(pattern.test(candidate));
    }
    expect(isFlowId('captacion-leads')).toBe(true);
    expect(isFlowId('../flows/hola')).toBe(false);
  });

  it('versión: entero de 1 a 2147483647 sin ceros ni signo', () => {
    expect(parseVersion('1')).toBe(1);
    expect(parseVersion('2147483647')).toBe(2_147_483_647);
    for (const bad of ['0', '01', '-1', '1.5', '2147483648', '12345678901', '', ' 1', '1 ', '1e3', 'x']) expect(parseVersion(bad), bad).toBeNull();
    expect(parseVersion(1)).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it('offset: sin valor es 0, y se rechaza lo que no es un entero decimal de hasta 10 cifras', () => {
    expect(parseOffset(null)).toBe(0);
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset('0')).toBe(0);
    expect(parseOffset('100')).toBe(100);
    expect(parseOffset('2147483647')).toBe(2_147_483_647);
    for (const bad of ['-1', '1.5', '2147483648', '12345678901', '', ' 1', 'x', '1e3', '١']) expect(parseOffset(bad), bad).toBeNull();
  });
});
