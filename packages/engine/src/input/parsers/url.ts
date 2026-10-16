import { MAX_INPUT_LENGTH } from '../../constants.js';
import { isAsciiAlnum, isAsciiAlpha, isBlank, isControl, isDefaultIgnorable } from './chars.js';
import { isDomainName } from './domain.js';
import type { TextParser } from './types.js';

/**
 * El parser WHATWG quita o cambia en silencio estos caracteres: se rechazan antes de usarlo. Los
 * sustitutos sueltos y U+0000 ya los rechazó `hasUnstorable` en `checkTextAnswer`.
 */
function hasHiddenChars(text: string): boolean {
  for (const c of text) {
    if (isBlank(c) || isControl(c) || (c > '~' && isDefaultIgnorable(c))) return true;
  }
  return false;
}

/**
 * Esquema al principio del texto según RFC 3986 (`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`
 * seguido de `://`), en minúsculas; `undefined` si el texto no empieza por un esquema, aunque
 * contenga `://` más adelante (`example.com/?u=http://y.com`).
 */
function explicitScheme(text: string): string | undefined {
  const end = text.indexOf('://');
  if (end < 1 || !isAsciiAlpha(text[0]!)) return undefined;
  for (const c of text.slice(0, end)) if (!isAsciiAlnum(c) && c !== '+' && c !== '-' && c !== '.') return undefined;
  return text.slice(0, end).toLowerCase();
}

/**
 * `%` en el host: el parser lo decodificaría y después quitaría en silencio los invisibles
 * codificados (`exa%C2%ADmple.com`). Empieza tras las `/` o `\` iniciales, que WHATWG ignora en
 * http y https, y llega hasta el primer `/`, `?`, `#` o `\`.
 */
function hasPercentInHost(text: string, start: number): boolean {
  let i = start;
  while (i < text.length && (text[i] === '/' || text[i] === '\\')) i++;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '/' || c === '?' || c === '#' || c === '\\') return false;
    if (c === '%') return true;
  }
  return false;
}

/**
 * `url`: URL absoluta WHATWG (`URL` del runtime) http o https, sin usuario ni contraseña, con un
 * dominio como host (no IP) y una serialización de 4096 unidades como mucho. Se guarda `href`, que
 * canonicaliza sin cambiar el recurso (host en minúsculas e IDNA, `\` → `/`, segmentos `.`/`..`,
 * puerto por defecto).
 */
export const parseUrl: TextParser = (text) => {
  if (hasHiddenChars(text)) return undefined;
  const scheme = explicitScheme(text);
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') return undefined;
  if (hasPercentInHost(text, scheme === undefined ? 0 : scheme.length + 3)) return undefined;
  let url: URL;
  try {
    url = new URL(scheme === undefined ? `https://${text}` : text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '' || !isDomainName(url.hostname)) return undefined;
  return url.href.length <= MAX_INPUT_LENGTH ? url.href : undefined;
};
