import { isAsciiDigit } from './chars.js';
import type { TextParser } from './types.js';

const MAX_SIGNIFICANT = 15;
const SMALLEST_NORMAL = 2 ** -1022;

/** Cifras significativas: de la primera a la última cifra distinta de cero. */
function significantDigits(digits: string): number {
  let start = 0;
  let end = digits.length;
  while (start < end && digits[start] === '0') start++;
  while (end > start && digits[end - 1] === '0') end--;
  return end - start;
}

/**
 * `number`: signo opcional, dígitos ASCII y, opcionalmente, `.` o `,` con decimales. Se rechaza lo
 * ambiguo como separador de miles (1 a 3 dígitos enteros sin cero inicial y justo 3 decimales) y lo
 * que no se guardaría exactamente: más de 15 cifras significativas o un valor que no es un number
 * normal (desbordamiento, subdesbordamiento o subnormal).
 */
export const parseNumber: TextParser = (text) => {
  let i = text[0] === '+' || text[0] === '-' ? 1 : 0;
  const negative = text[0] === '-';
  const intStart = i;
  while (i < text.length && isAsciiDigit(text[i]!)) i++;
  const integer = text.slice(intStart, i);
  if (integer.length === 0) return undefined;
  let decimals = '';
  if (i < text.length) {
    if (text[i] !== '.' && text[i] !== ',') return undefined;
    const decStart = ++i;
    while (i < text.length && isAsciiDigit(text[i]!)) i++;
    decimals = text.slice(decStart, i);
    if (decimals.length === 0 || i !== text.length) return undefined;
  }
  if (decimals.length === 3 && integer.length <= 3 && integer[0] !== '0') return undefined;
  const significant = significantDigits(integer + decimals);
  if (significant === 0) return 0;
  if (significant > MAX_SIGNIFICANT) return undefined;
  const value = Number(`${negative ? '-' : ''}${integer}${decimals ? `.${decimals}` : ''}`);
  if (!Number.isFinite(value) || Math.abs(value) < SMALLEST_NORMAL) return undefined;
  return value;
};
