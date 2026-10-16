import { isAsciiAlnum } from './chars.js';
import { isDomainName } from './domain.js';
import type { TextParser } from './types.js';

const MAX_LOCAL = 64;
const MAX_TOTAL = 254;
// Clase de la gramática «valid e-mail address» de WHATWG (parte local).
const LOCAL_SPECIALS = ".!#$%&'*+/=?^_`{|}~-";

/** `email`: gramática WHATWG (ASCII), dominio con la regla de `isDomainName`; dominio en minúsculas. */
export const parseEmail: TextParser = (text) => {
  if (text.length > MAX_TOTAL) return undefined;
  const at = text.indexOf('@');
  if (at < 1 || at !== text.lastIndexOf('@')) return undefined;
  const local = text.slice(0, at);
  const domain = text.slice(at + 1);
  if (local.length > MAX_LOCAL) return undefined;
  for (const c of local) if (!isAsciiAlnum(c) && !LOCAL_SPECIALS.includes(c)) return undefined;
  if (!isDomainName(domain)) return undefined;
  return `${local}@${domain.toLowerCase()}`;
};
