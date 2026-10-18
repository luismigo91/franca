import { describe, expect, it } from 'vitest';
import { flowText, utf8Bytes } from '@/lib/editor/flow-text';

describe('flowText y utf8Bytes', () => {
  it('flowText es JSON.stringify', () => {
    expect(flowText({ a: [1, { b: null }] })).toBe('{"a":[1,{"b":null}]}');
  });

  it('un número de 1e400 ya normalizado se queda en null', () => {
    expect(flowText(JSON.parse(JSON.stringify(JSON.parse('{"a":1e400}'))))).toBe('{"a":null}');
  });

  it('ñ cuenta dos bytes y un emoji cuatro', () => {
    expect(utf8Bytes('ñ')).toBe(2);
    expect(utf8Bytes('a')).toBe(1);
    expect(utf8Bytes('😀')).toBe(4);
  });
});
