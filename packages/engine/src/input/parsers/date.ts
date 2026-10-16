import { isAsciiDigit } from './chars.js';
import type { TextParser } from './types.js';

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number): boolean => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/** `date`: `AAAA-MM-DD` gregoriano, año 0001-9999. Aritmética pura: sin `Date`. */
export const parseDate: TextParser = (text) => {
  if (text.length !== 10 || text[4] !== '-' || text[7] !== '-') return undefined;
  for (let i = 0; i < 10; i++) if (i !== 4 && i !== 7 && !isAsciiDigit(text[i]!)) return undefined;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return undefined;
  const max = month === 2 && isLeap(year) ? 29 : DAYS[month - 1]!;
  return day <= max ? text : undefined;
};
