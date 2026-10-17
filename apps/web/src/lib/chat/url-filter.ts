/** Para qué se pinta la dirección: `embed` solo admite `https:`. */
export type MediaKind = 'image' | 'video' | 'audio' | 'embed' | 'option-image';

/**
 * Decide si una dirección de multimedia o de `imageUrl` se admite (D13). La decisión se toma sobre la URL **parseada** y
 * se devuelve su `href`, que es lo único que se pinta: `new URL` quita tabuladores y saltos de línea, así que
 * `java\nscript:` se vuelve `javascript:` y se rechaza por su protocolo.
 *
 * Se admite una URL absoluta WHATWG sin usuario ni contraseña, con `https:` o, salvo en `embed`, `http:`.
 *
 * @param raw Lo que trae el evento (puede no ser un texto).
 * @param kind El elemento que la usará.
 * @returns El `href` serializado, o `null` si no se admite.
 */
export function admitUrl(raw: unknown, kind: MediaKind): string | null {
  if (typeof raw !== 'string' || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  const allowed = kind === 'embed' ? url.protocol === 'https:' : url.protocol === 'https:' || url.protocol === 'http:';
  if (!allowed) return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}
