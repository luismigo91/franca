/** Predicados de carácter para los conversores. Sin expresiones regulares sobre texto del usuario. */

/** @returns `true` si `c` es un dígito ASCII. */
export const isAsciiDigit = (c: string): boolean => c >= '0' && c <= '9' && c.length === 1;

/** @returns `true` si `c` es una letra ASCII. */
export const isAsciiAlpha = (c: string): boolean => c.length === 1 && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));

/** @returns `true` si `c` es una letra o un dígito ASCII. */
export const isAsciiAlnum = (c: string): boolean =>
  c.length === 1 && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'));

/** @returns `true` si `c` es un espacio en blanco, en el sentido de `String.prototype.trim`. */
export const isBlank = (c: string): boolean => c.length > 0 && c.trim() === '';

/** @returns `true` si la unidad de código es un carácter de control (U+0000 a U+001F y U+007F). */
export const isControl = (c: string): boolean => {
  const code = c.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
};

/**
 * @returns `true` si el texto contiene U+0000 o un sustituto UTF-16 suelto: un valor así no se
 *   puede guardar en un almacén JSON como `jsonb`.
 */
export function hasUnstorable(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) return true;
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    }
  }
  return false;
}

/**
 * @param codePoint Un único code point.
 * @returns `true` si tiene la propiedad Unicode `Default_Ignorable_Code_Point`. Es la única
 *   expresión regular nativa del directorio: se prueba sobre un code point, así que su coste es
 *   constante, y la tabla de la propiedad solo la tiene el runtime.
 */
export const isDefaultIgnorable = (codePoint: string): boolean => /^\p{Default_Ignorable_Code_Point}$/u.test(codePoint);
