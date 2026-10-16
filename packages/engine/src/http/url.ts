import { MAX_URL_LENGTH } from '../constants.js';
import { hasUnstorable } from '../input/parsers/chars.js';
import { checkParsedUrl, hasHiddenChars, hasPercentInHost } from '../input/parsers/url.js';
import { renderTemplate, ValueTooLargeError } from '../template.js';
import type { VariableValue } from '../types.js';

/** El valor insertado no se puede codificar (sustituto UTF-16 suelto). Interna: la captura `buildRequestUrl`. */
class InvalidUrlError extends Error {}

const SUB_DELIMS: Readonly<Record<string, string>> = { '!': '%21', "'": '%27', '(': '%28', ')': '%29', '*': '%2A' };

/**
 * Codifica el texto de un valor insertado en la URL: UTF-8 con `%XX` en mayúsculas salvo
 * `A-Z a-z 0-9 - . _ ~`. `encodeURIComponent` deja sin codificar `! ' ( ) *`; un post-pase de una
 * pasada los codifica.
 *
 * @param text Forma textual del valor.
 * @param budget Unidades que quedan hasta el límite de la URL.
 * @returns El texto codificado.
 * @throws {ValueTooLargeError} Si el texto ya supera el presupuesto: codificar nunca encoge, así que
 *   se comprueba antes de recorrerlo.
 * @throws {InvalidUrlError} Si el texto tiene un sustituto suelto.
 */
export function encodeUrlValue(text: string, budget: number): string {
  if (text.length > budget) throw new ValueTooLargeError();
  let encoded: string;
  try {
    encoded = encodeURIComponent(text);
  } catch {
    throw new InvalidUrlError();
  }
  let out = '';
  for (let i = 0; i < encoded.length; i++) out += SUB_DELIMS[encoded[i]!] ?? encoded[i];
  return out;
}

/** Normaliza `%2e` (sin distinguir mayúsculas) a `.`: así `.%2E`, `%2e.` y `%2E%2e` se ven como los trata WHATWG. */
function decodeDots(segment: string): string {
  let out = '';
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === '%' && segment[i + 1] === '2' && (segment[i + 2] === 'e' || segment[i + 2] === 'E')) {
      out += '.';
      i += 2;
    } else {
      out += segment[i];
    }
  }
  return out;
}

/**
 * @returns `true` si algún segmento de la ruta es `.` o `..`, también escrito con `%2e`. La ruta va
 * desde la primera `/` tras la autoridad hasta el primer `?` (el `#` ya se rechazó antes): una `/`
 * que está dentro de la consulta, como en `https://host?x=/../y`, no abre una ruta.
 */
function hasDotSegment(text: string, authorityStart: number): boolean {
  const query = text.indexOf('?', authorityStart);
  const end = query === -1 ? text.length : query;
  const slash = text.indexOf('/', authorityStart);
  if (slash === -1 || slash > end) return false;
  for (const segment of text.slice(slash, end).split('/')) {
    const decoded = decodeDots(segment);
    if (decoded === '.' || decoded === '..') return true;
  }
  return false;
}

/**
 * Valida el texto de una URL ya renderizada. Orden: esquema, caracteres ocultos y `\`/`#`, `%` en
 * el host, segmentos de punto, parser WHATWG, destino (dominio, no `localhost`) y longitud.
 *
 * @param text URL renderizada.
 * @returns La serialización WHATWG (`href`), o `undefined` si la URL no es válida.
 */
export function validateUrlText(text: string): string | undefined {
  const head = text.slice(0, 8).toLowerCase();
  const authorityStart = head.startsWith('https://') ? 8 : head.startsWith('http://') ? 7 : -1;
  if (authorityStart === -1) return undefined;
  if (hasUnstorable(text) || hasHiddenChars(text) || text.includes('\\') || text.includes('#')) return undefined;
  if (hasPercentInHost(text, authorityStart)) return undefined;
  if (hasDotSegment(text, authorityStart)) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  const href = checkParsedUrl(url, MAX_URL_LENGTH);
  if (href === undefined) return undefined;
  const host = url.hostname;
  return host === 'localhost' || host.endsWith('.localhost') ? undefined : href;
}

export type BuiltUrl = { ok: true; url: string } | { ok: false };

/**
 * Renderiza la `url` del nodo con los valores codificados y la valida. La URL nunca produce
 * `value_too_large`: pasarse de longitud o un sustituto suelto la hacen inválida.
 *
 * @param template Plantilla de la `url`.
 * @param lookup Valor actual de una variable.
 * @returns La URL serializada, o `{ ok: false }` (`invalid_url`).
 */
export function buildRequestUrl(template: string, lookup: (name: string) => VariableValue | undefined): BuiltUrl {
  let rendered: string;
  try {
    rendered = renderTemplate(template, lookup, { maxLength: MAX_URL_LENGTH, insert: encodeUrlValue });
  } catch (error) {
    if (error instanceof ValueTooLargeError || error instanceof InvalidUrlError) return { ok: false };
    throw error;
  }
  const url = validateUrlText(rendered);
  return url === undefined ? { ok: false } : { ok: true, url };
}
