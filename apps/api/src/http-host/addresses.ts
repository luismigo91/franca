import { isIP } from 'node:net';
import { IPV4_SPECIAL_PURPOSE, IPV6_SPECIAL_PURPOSE, type SpecialPurposeEntry } from './special-purpose-addresses.js';

/** Una dirección IP analizada: sus bytes (4 o 16) y, si llevaba zona (`%en0`), la zona. */
export interface ParsedIp {
  readonly family: 4 | 6;
  readonly bytes: Uint8Array;
  /** Zona de una IPv6 de ámbito (`%en0`); `null` si no la tiene. Una dirección con zona nunca es global. */
  readonly zone: string | null;
}

const DECIMAL_OCTET = /^(0|[1-9][0-9]{0,2})$/;

function parseIpv4Text(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (const [index, part] of parts.entries()) {
    if (!DECIMAL_OCTET.test(part) || Number(part) > 255) return null;
    bytes[index] = Number(part);
  }
  return bytes;
}

function parseIpv6Text(text: string): Uint8Array | null {
  let rest = text;
  // IPv4 incrustada en texto (`::ffff:1.2.3.4`, `::127.0.0.1`): se pasa a dos grupos hexadecimales.
  if (rest.includes('.')) {
    const cut = rest.lastIndexOf(':') + 1;
    const v4 = parseIpv4Text(rest.slice(cut));
    if (v4 === null) return null;
    rest = `${rest.slice(0, cut)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = rest.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (part: string | undefined): string[] => (part === undefined || part === '' ? [] : part.split(':'));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const bytes = new Uint8Array(16);
  for (const [index, group] of groups.entries()) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

/**
 * Analiza una dirección IP escrita en cualquier forma (IPv6 con `::`, con ceros, con IPv4 incrustada o con zona).
 * **Falla cerrado**: lo que no es un texto, o no es una IP bien escrita, da `null` y la política lo trata como
 * una dirección no global y no permitida.
 *
 * @param text Lo que devolvió el resolutor o la configuración.
 * @returns La dirección analizada, o `null`.
 */
export function parseIp(text: unknown): ParsedIp | null {
  if (typeof text !== 'string') return null;
  const family = isIP(text);
  if (family === 4) {
    const bytes = parseIpv4Text(text);
    return bytes === null ? null : { family: 4, bytes, zone: null };
  }
  if (family === 6) {
    const percent = text.indexOf('%');
    const zone = percent === -1 ? null : text.slice(percent + 1);
    const bytes = parseIpv6Text(percent === -1 ? text : text.slice(0, percent));
    return bytes === null ? null : { family: 6, bytes, zone };
  }
  return null;
}

/** `true` si los primeros `length` bits de `bytes` son los de `prefix`. */
function isInPrefix(bytes: Uint8Array, prefix: Uint8Array, length: number): boolean {
  const whole = length >> 3;
  for (let index = 0; index < whole; index++) if (bytes[index] !== prefix[index]) return false;
  const remainder = length & 7;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (bytes[whole]! & mask) === (prefix[whole]! & mask);
}

interface CompiledEntry {
  readonly prefix: Uint8Array;
  readonly length: number;
  readonly globallyReachable: boolean | null;
}

const compile = (entries: readonly SpecialPurposeEntry[]): readonly CompiledEntry[] =>
  entries.map((entry) => {
    const parsed = parseIp(entry.address);
    if (parsed === null) throw new Error(`entrada de IANA no válida: ${entry.address}`);
    return { prefix: parsed.bytes, length: entry.length, globallyReachable: entry.globallyReachable };
  });

const V4_TABLE = compile(IPV4_SPECIAL_PURPOSE);
const V6_TABLE = compile(IPV6_SPECIAL_PURPOSE);

const prefixOf = (address: string): Uint8Array => parseIp(address)!.bytes;
const MAPPED = prefixOf('::ffff:0:0');
const NAT64 = prefixOf('64:ff9b::');
const COMPATIBLE = prefixOf('::');
const NAT64_LOCAL = prefixOf('64:ff9b:1::');
const SIX_TO_FOUR = prefixOf('2002::');
const TEREDO = prefixOf('2001::');
const MULTICAST_V4 = prefixOf('224.0.0.0');
const GLOBAL_UNICAST_V6 = prefixOf('2000::');

/** La IPv4 que incrusta una IPv6 mapeada (`::ffff:0:0/96`) o NAT64 (`64:ff9b::/96`); `null` si no es ninguna de las dos. */
function embeddedIpv4(parsed: ParsedIp): Uint8Array | null {
  if (parsed.family !== 6) return null;
  if (!isInPrefix(parsed.bytes, MAPPED, 96) && !isInPrefix(parsed.bytes, NAT64, 96)) return null;
  return parsed.bytes.slice(12, 16);
}

/** Está fuera de la tabla o dentro de alguna de sus entradas con «Globally Reachable» `True`. */
function isReachableByRegistry(bytes: Uint8Array, table: readonly CompiledEntry[]): boolean {
  const matching = table.filter((entry) => isInPrefix(bytes, entry.prefix, entry.length));
  return matching.length === 0 || matching.some((entry) => entry.globallyReachable === true);
}

/**
 * Indica si una dirección es unicast global según los registros de propósito especial de IANA:
 * - IPv4: no multicast (`224.0.0.0/4`) y fuera del registro, o dentro de una entrada «Globally Reachable» `True`.
 * - IPv6: en `2000::/3` y fuera del registro o dentro de una entrada `True`. Las mapeadas y las NAT64 (`64:ff9b::/96`) se
 *   juzgan por la IPv4 que incrustan; `::/96`, `64:ff9b:1::/48`, 6to4 y Teredo nunca son globales; una zona tampoco.
 *
 * @param parsed La dirección analizada.
 * @returns `true` si es unicast global.
 */
export function isGlobalUnicast(parsed: ParsedIp): boolean {
  if (parsed.zone !== null) return false;
  const embedded = embeddedIpv4(parsed);
  if (embedded !== null) return isGlobalUnicast({ family: 4, bytes: embedded, zone: null });
  if (parsed.family === 4) return !isInPrefix(parsed.bytes, MULTICAST_V4, 4) && isReachableByRegistry(parsed.bytes, V4_TABLE);
  const { bytes } = parsed;
  if (isInPrefix(bytes, COMPATIBLE, 96) || isInPrefix(bytes, NAT64_LOCAL, 48) || isInPrefix(bytes, SIX_TO_FOUR, 16) || isInPrefix(bytes, TEREDO, 32)) {
    return false;
  }
  return isInPrefix(bytes, GLOBAL_UNICAST_V6, 3) && isReachableByRegistry(bytes, V6_TABLE);
}

const hex = (bytes: Uint8Array, index: number): string => ((bytes[index * 2]! << 8) | bytes[index * 2 + 1]!).toString(16);

/** IPv6 en la forma de RFC 5952: minúsculas, sin ceros a la izquierda y la racha de ceros más larga (de dos o más grupos) comprimida. */
function formatIpv6(bytes: Uint8Array): string {
  const groups = Array.from({ length: 8 }, (_unused, index) => hex(bytes, index));
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < 8; ) {
    if (groups[start] !== '0') {
      start++;
      continue;
    }
    let end = start;
    while (end < 8 && groups[end] === '0') end++;
    if (end - start > bestLength) [bestStart, bestLength] = [start, end - start];
    start = end;
  }
  if (bestLength < 2) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`;
}

/**
 * La forma canónica de una dirección: IPv4 en decimal con puntos; una IPv6 mapeada (`::ffff:0:0/96`), como su IPv4; el
 * resto de IPv6 en la forma de RFC 5952 (con `%zona` si la tenía). Es la que ven la política, la lista de permitidos y el abridor.
 *
 * @param parsed La dirección analizada.
 * @returns El texto canónico.
 */
export function canonicalIp(parsed: ParsedIp): string {
  if (parsed.family === 4) return Array.from(parsed.bytes).join('.');
  if (isInPrefix(parsed.bytes, MAPPED, 96)) return Array.from(parsed.bytes.slice(12, 16)).join('.');
  const text = formatIpv6(parsed.bytes);
  return parsed.zone === null ? text : `${text}%${parsed.zone}`;
}

/**
 * Clave de comparación de un destino: `<canónica>|<puerto>`. La lista de permitidos se compara por clave, nunca por texto escrito.
 *
 * @param address La dirección, escrita de cualquier forma.
 * @param port El puerto.
 * @returns La clave, o `null` si `address` no es una dirección.
 */
export function destinationKey(address: unknown, port: number): string | null {
  const parsed = parseIp(address);
  return parsed === null ? null : `${canonicalIp(parsed)}|${port}`;
}
