import type { HttpNode } from '@franca/spec';
import { MAX_HTTP_HEADERS } from '../constants.js';
import { isAsciiAlnum } from '../input/parsers/chars.js';
import { checkPointerEscapes } from './response-map.js';

const TCHAR_SYMBOLS = "!#$%&'*+-.^_`|~";
const RESERVED = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'expect']);

/** @returns `true` si el nombre es un token de RFC 9110: al menos un `tchar` y solo `tchar`. */
function isToken(name: string): boolean {
  if (name.length === 0) return false;
  for (const c of name) if (!isAsciiAlnum(c) && !TCHAR_SYMBOLS.includes(c)) return false;
  return true;
}

/** Minúsculas ASCII; solo se llama con tokens, así que no hay plegado Unicode (`K` U+212A → `k`). */
const lowerAscii = (name: string): string => name.toLowerCase();

const isReserved = (lower: string): boolean => RESERVED.has(lower) || lower.startsWith('proxy-');

/**
 * Comprueba la configuración de un nodo `http` que el motor no puede ejecutar. Se llama antes de
 * renderizar nada. Los mensajes son fijos por causa y no nombran la cabecera ni el puntero.
 *
 * @param node Nodo `http` (forma JSON).
 * @returns El motivo, o `null` si la configuración es ejecutable.
 */
export function checkHttpConfig(node: HttpNode): string | null {
  const names = Object.keys(node.request.headers ?? {});
  if (names.length > MAX_HTTP_HEADERS) return `el nodo declara más de ${MAX_HTTP_HEADERS} cabeceras`;
  const seen = new Set<string>();
  for (const name of names) {
    if (!isToken(name)) return 'el nombre de una cabecera no es un token válido';
    const lower = lowerAscii(name);
    if (seen.has(lower)) return 'dos cabeceras tienen el mismo nombre';
    seen.add(lower);
    if (isReserved(lower)) return 'una cabecera está reservada al host';
  }
  const body: unknown = node.request.body;
  if (node.request.method === 'GET' && body !== undefined && body !== null) return 'una petición GET no puede llevar body';
  for (const entry of node.responseMap ?? []) {
    if (!checkPointerEscapes(entry.pointer)) return 'un puntero de responseMap tiene un escape ~ inválido';
  }
  return null;
}
