import { describe, expect, it } from 'vitest';
import schema from '@franca/spec/flow.schema.json';
import { KNOWN_CONTENT_KINDS, KNOWN_EVENT_TYPES, KNOWN_INPUT_TYPES, KNOWN_TYPES_ARE_EXHAUSTIVE } from '@/lib/chat/known-types';

describe('known-types', () => {
  it('KNOWN_INPUT_TYPES es igual al enum inputType del esquema de @franca/spec', () => {
    expect([...KNOWN_INPUT_TYPES].sort()).toEqual([...schema.$defs.inputNode.properties.inputType.enum].sort());
  });

  it('KNOWN_CONTENT_KINDS es igual a la unión del const y del enum de kind de contentItem', () => {
    const kinds = schema.$defs.contentItem.oneOf.flatMap((variant) => {
      const kind = variant.properties.kind as { const?: string; enum?: string[] };
      return kind.const !== undefined ? [kind.const] : (kind.enum ?? []);
    });
    expect(kinds.length).toBeGreaterThan(1);
    expect([...KNOWN_CONTENT_KINDS].sort()).toEqual([...kinds].sort());
  });

  it('los tipos de evento no tienen repetidos y la comprobación de exhaustividad de tipos está en verde', () => {
    expect(new Set(KNOWN_EVENT_TYPES).size).toBe(KNOWN_EVENT_TYPES.length);
    expect(KNOWN_TYPES_ARE_EXHAUSTIVE).toBe(true);
  });
});
