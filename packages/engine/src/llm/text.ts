import { MAX_INPUT_LENGTH } from '../constants.js';
import { hasUnstorable } from '../input/parsers/chars.js';

/**
 * Comprueba el texto del asistente: recortado, no vacío, de 4096 unidades como mucho (medido
 * **después** de recortar, a diferencia del mensaje del usuario) y sin U+0000 ni sustitutos sueltos
 * (solo se busca si ya cabe). El texto se emite literal: nunca es una plantilla.
 *
 * @param raw El `text` del resultado del host.
 * @returns El texto recortado, o `null` si no se puede emitir (→ `invalid_turn`).
 */
export function readAssistantText(raw: string): string | null {
  const text = raw.trim();
  if (text === '' || text.length > MAX_INPUT_LENGTH || hasUnstorable(text)) return null;
  return text;
}
