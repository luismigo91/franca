import { MAX_INPUT_LENGTH } from '../../constants.js';
import { hasUnstorable, isBlank, isControl, isDefaultIgnorable } from './chars.js';
import { isDomainName } from './domain.js';
import type { TextParser } from './types.js';

/** El parser WHATWG quita o cambia en silencio estos caracteres: se rechazan antes de usarlo. */
function hasHiddenChars(text: string): boolean {
  if (hasUnstorable(text)) return true;
  for (const c of text) {
    if (isBlank(c) || isControl(c) || (c > '~' && isDefaultIgnorable(c))) return true;
  }
  return false;
}

/** Antepone `https://` si no hay esquema; `undefined` si hay otro esquema. */
function withScheme(text: string): string | undefined {
  const head = text.slice(0, 8).toLowerCase();
  if (head.startsWith('http://') || head.startsWith('https://')) return text;
  return text.includes('://') ? undefined : `https://${text}`;
}

/**
 * `url`: URL absoluta WHATWG (`URL` del runtime) http o https, sin usuario ni contraseña, con un
 * dominio como host (no IP) y una serialización de 4096 unidades como mucho. Se guarda `href`.
 */
export const parseUrl: TextParser = (text) => {
  if (hasHiddenChars(text)) return undefined;
  const candidate = withScheme(text);
  if (candidate === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '' || !isDomainName(url.hostname)) return undefined;
  return url.href.length <= MAX_INPUT_LENGTH ? url.href : undefined;
};
