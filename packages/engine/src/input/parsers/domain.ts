import { isAsciiAlnum, isAsciiDigit } from './chars.js';

const MAX_LABEL = 63;

function isLabel(label: string): boolean {
  if (label.length === 0 || label.length > MAX_LABEL) return false;
  if (!isAsciiAlnum(label[0]!) || !isAsciiAlnum(label[label.length - 1]!)) return false;
  for (const c of label) if (c !== '-' && !isAsciiAlnum(c)) return false;
  return true;
}

/**
 * Regla del dominio de un email, compartida con el host de una `url`: al menos dos etiquetas de
 * letras ASCII, dígitos y `-` (sin `-` en los extremos, de 1 a 63 caracteres); la última de dos
 * caracteres o más y no solo dígitos. Excluye direcciones IPv4 e IPv6 y deja pasar `xn--…`.
 *
 * @param domain Dominio, ya en ASCII.
 * @returns `true` si cumple la regla.
 */
export function isDomainName(domain: string): boolean {
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every(isLabel)) return false;
  const last = labels[labels.length - 1]!;
  return last.length >= 2 && ![...last].every(isAsciiDigit);
}
