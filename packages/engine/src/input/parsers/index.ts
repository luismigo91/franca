import type { InputType } from '../../types.js';
import { parseBoolean } from './boolean.js';
import { parseDate } from './date.js';
import { parseEmail } from './email.js';
import { parseNumber } from './number.js';
import { parsePhone } from './phone.js';
import { parseText } from './text.js';
import type { TextParser } from './types.js';
import { parseUrl } from './url.js';

/** Un conversor por cada `inputType` salvo `choice`; el tipo mapeado falla si el esquema añade uno. */
export const PARSERS: { [K in Exclude<InputType, 'choice'>]: TextParser } = {
  text: parseText,
  email: parseEmail,
  phone: parsePhone,
  number: parseNumber,
  url: parseUrl,
  date: parseDate,
  boolean: parseBoolean,
};
