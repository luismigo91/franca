import { describe, expect, it } from 'vitest';
import { canonicalOf, localAfterEdit, validLocal } from '@/lib/editor/local-text';

describe('local-text', () => {
  it('un estado local vale mientras el valor del flujo sea el de su base (mutante staleJsonText)', () => {
    const local = { data: '{"all":[1]}', basis: canonicalOf({ all: [1] }) };
    expect(validLocal(local, { all: [1] })).toBe('{"all":[1]}');
    expect(validLocal(local, { any: [2] })).toBeNull();
    expect(validLocal(local, undefined)).toBeNull();
    expect(validLocal(null, 5)).toBeNull();
  });

  it('distingue undefined, null y ausente', () => {
    expect(canonicalOf(undefined)).toBe('undefined');
    expect(canonicalOf(null)).toBe('null');
    expect(validLocal({ data: 'x', basis: canonicalOf(undefined) }, null)).toBeNull();
  });

  it('tras una edición aplicada la base es el valor nuevo; si se rechazó, el de antes', () => {
    const ok = { ok: true as const, flow: { a: { b: 7 } } };
    expect(localAfterEdit('7', ok, '/a/b', 1)).toEqual({ data: '7', basis: '7' });
    expect(localAfterEdit('{', { ok: false, error: 'x' }, '/a/b', 1)).toEqual({ data: '{', basis: '1' });
  });
});
