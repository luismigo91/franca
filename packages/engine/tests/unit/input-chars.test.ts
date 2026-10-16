import { describe, expect, it } from 'vitest';
import { hasUnstorable, isBlank, isControl, isDefaultIgnorable } from '../../src/input/parsers/chars.js';
import { PARSERS } from '../../src/input/parsers/index.js';

describe('hasUnstorable', () => {
  it.each(['\u0000', 'a\u0000b', '\ud800', '\udc00', 'a\ud800', '\udc00a', '\ud800\ud800', '\udc00\ud800'])(
    '%j no se puede guardar',
    (text) => expect(hasUnstorable(text)).toBe(true),
  );
  it.each(['', 'Ana', 'Ana 😀', '😀', '\u{10FFFF}', '�', '\u0001'])('%j se puede guardar', (text) =>
    expect(hasUnstorable(text)).toBe(false),
  );
});

describe('predicados de carácter', () => {
  it('isBlank sigue a String.prototype.trim', () => {
    for (const c of [' ', '\t', '\n', ' ', ' ', ' ', '﻿', '　']) expect(isBlank(c), c).toBe(true);
    for (const c of ['a', '0', '​', '', '-']) expect(isBlank(c), c).toBe(false);
  });
  it('isControl', () => {
    expect(isControl('\u0000')).toBe(true);
    expect(isControl('\u001f')).toBe(true);
    expect(isControl('\u007f')).toBe(true);
    expect(isControl(' ')).toBe(false);
    expect(isControl('~')).toBe(false);
  });
  it('isDefaultIgnorable', () => {
    for (const c of ['­', '​', '‍', '﻿', '️', '\u{e0100}', '⁠', '͏']) expect(isDefaultIgnorable(c)).toBe(true);
    for (const c of ['a', ' ', '😀', 'ñ']) expect(isDefaultIgnorable(c)).toBe(false);
  });
});

describe('texto con emoji y caracteres raros', () => {
  it('text conserva un emoji; el resto de tipos lo rechazan o lo codifican', () => {
    expect(PARSERS.text('Ana 😀', 'es')).toBe('Ana 😀');
    expect(PARSERS.email('ana😀@example.com', 'es')).toBeUndefined();
    expect(PARSERS.phone('600😀123456', 'es')).toBeUndefined();
    expect(PARSERS.number('1😀', 'es')).toBeUndefined();
    expect(PARSERS.date('2026-10-1😀', 'es')).toBeUndefined();
    expect(PARSERS.boolean('😀', 'es')).toBeUndefined();
  });
});
