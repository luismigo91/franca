import { describe, expect, it } from 'vitest';
import { parseFlowId, parseVersion } from './flow-params.js';

describe('parseFlowId', () => {
  it.each(['hola', 'captacion-leads', 'a', 'a_b-9', 'a'.repeat(64), 'validate'])('admite %s', (id) => {
    expect(parseFlowId(id)).toBe(id);
  });

  it.each(['Captacion-Leads', '1abc', '-a', '_a', '', 'a'.repeat(65), 'con espacio', 'ñ', 'a/b', 'a.b', 'hola\n'])(
    'rechaza %j con flow_not_found',
    (id) => {
      expect(() => parseFlowId(id)).toThrowError(expect.objectContaining({ code: 'flow_not_found' }));
    },
  );
});

describe('parseVersion', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['10', 10],
    ['2147483647', 2147483647],
  ])('%s es la versión %i', (value, expected) => {
    expect(parseVersion(value)).toBe(expected);
  });

  it.each(['0', '01', '-1', '+1', '1.0', '1e3', 'latest', '', ' 1', '2147483648', '99999999999999999999'])('%j no es una versión', (value) => {
    expect(parseVersion(value)).toBeUndefined();
  });
});
