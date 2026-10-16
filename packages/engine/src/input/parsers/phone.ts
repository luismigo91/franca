import { isAsciiDigit, isBlank } from './chars.js';
import type { TextParser } from './types.js';

const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

/** `phone`: `+` opcional en la posición 0 y resto de dígitos, espacios, `-`, `.`, `(` y `)`; 7 a 15 dígitos. */
export const parsePhone: TextParser = (text) => {
  const plus = text[0] === '+';
  let digits = '';
  for (const c of plus ? text.slice(1) : text) {
    if (isAsciiDigit(c)) digits += c;
    else if (!isBlank(c) && c !== '-' && c !== '.' && c !== '(' && c !== ')') return undefined;
  }
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return undefined;
  return (plus ? '+' : '') + digits;
};
