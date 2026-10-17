import { ConfigError } from '../config/app-config.js';
import type { ResolvedEntry } from './destination-policy.js';
import { isNodeUrlOrigin } from './secret-origin.js';

/** Variable con las entradas `nombre=dirección` de los nombres locales. */
export const LOCAL_NAMES_VARIABLE = 'FRANCA_HTTP_LOCAL_NAMES';

/** Todo nombre local termina así (RFC 6761: `.test` está reservado y nunca existe en el DNS público). */
const LOCAL_SUFFIX = '.test';
const DECIMAL_OCTET = /^(?:0|[1-9][0-9]{0,2})$/;

/** Una dirección de loopback de un nombre local. */
export interface LocalAddress {
  /** Tal como se escribió (`127.0.0.1`, `[::1]`): lo que muestra la línea de arranque. */
  readonly display: string;
  /** La dirección sin corchetes. */
  readonly address: string;
  readonly family: 4 | 6;
}

/** Un nombre local con todas sus direcciones, en el orden escrito. */
export interface LocalNameEntry {
  readonly name: string;
  readonly addresses: readonly LocalAddress[];
}

/** La búsqueda de nombres locales que consulta la resolución de la salida http. */
export interface LocalNames {
  /**
   * @param hostname El host de la `url`, tal como lo entrega WHATWG (en minúsculas).
   * @returns Sus direcciones en el orden escrito, o `undefined` si no es un nombre local.
   */
  lookup(hostname: string): readonly ResolvedEntry[] | undefined;
}

/** El nombre es un host que puede tener la `url` de un nodo `http`, escrito como su serialización y terminado en `.test`. */
async function isLocalName(name: string): Promise<boolean> {
  if (!name.endsWith(LOCAL_SUFFIX) || name.length === LOCAL_SUFFIX.length) return false;
  const origin = `http://${name}`;
  let serialized: string;
  try {
    serialized = new URL(origin).origin;
  } catch {
    return false;
  }
  return serialized === origin && (await isNodeUrlOrigin(origin));
}

/** `127.a.b.c` con cada octeto en decimal sin ceros a la izquierda, o exactamente `[::1]`. */
function parseLoopbackAddress(text: string): LocalAddress | null {
  if (text === '[::1]') return { display: text, address: '::1', family: 6 };
  const octets = text.split('.');
  if (octets.length !== 4 || octets[0] !== '127') return null;
  if (!octets.every((octet) => DECIMAL_OCTET.test(octet) && Number(octet) <= 255)) return null;
  return { display: text, address: text, family: 4 };
}

/**
 * Lee y valida `FRANCA_HTTP_LOCAL_NAMES`: entradas `nombre=dirección` separadas por comas. Se separa por la primera `=` de
 * cada entrada. Un nombre puede repetirse; sus direcciones se agrupan en el orden escrito y los nombres por orden de
 * primera aparición.
 *
 * @param value El valor de la variable (ausente o `""`: no hay nombres locales).
 * @returns Los nombres locales con sus direcciones.
 * @throws {ConfigError} Si una entrada está vacía o mal escrita; el mensaje nombra la variable y la posición, nunca el valor.
 */
export async function readLocalNames(value: string | undefined): Promise<LocalNameEntry[]> {
  if (value === undefined || value === '') return [];
  const byName = new Map<string, LocalAddress[]>();
  for (const [index, entry] of value.split(',').entries()) {
    const position = index + 1;
    const fail = (reason: string): never => {
      throw new ConfigError(`${LOCAL_NAMES_VARIABLE} no es válida: la entrada nº ${position} ${reason}`);
    };
    if (entry === '') fail('está vacía (sobra una coma o un espacio).');
    const equals = entry.indexOf('=');
    const name = equals === -1 ? entry : entry.slice(0, equals);
    if (equals === -1 || !(await isLocalName(name))) {
      fail('debe ser nombre=dirección, con un nombre de dominio en minúsculas terminado en .test (sin punto final, puerto, ruta ni espacios).');
    }
    const address = parseLoopbackAddress(entry.slice(equals + 1));
    if (address === null) {
      fail('debe llevar una dirección de loopback: una IPv4 de 127.0.0.0/8 en decimal sin ceros a la izquierda, o [::1], sin puerto.');
      continue;
    }
    const known = byName.get(name);
    if (known) known.push(address);
    else byName.set(name, [address]);
  }
  return [...byName].map(([name, addresses]) => ({ name, addresses }));
}

/**
 * Crea la búsqueda exacta por nombre. No hay comodines ni sufijos: `otro.franca.test` o `crm.franca.test.` no son locales.
 *
 * @param entries Los nombres locales ya validados.
 * @returns La búsqueda.
 */
export function createLocalNames(entries: readonly LocalNameEntry[]): LocalNames {
  const byName = new Map<string, readonly ResolvedEntry[]>();
  for (const entry of entries) byName.set(entry.name, entry.addresses.map(({ address, family }) => ({ address, family })));
  return { lookup: (hostname) => byName.get(hostname) };
}

/**
 * El fragmento de la línea de arranque: `ninguno`, o `<nombre> (<dir>, <dir>)` separados por `, `.
 *
 * @param entries Los nombres locales.
 * @returns El texto, sin ninguna dirección que no se haya escrito.
 */
export function describeLocalNames(entries: readonly LocalNameEntry[]): string {
  if (entries.length === 0) return 'ninguno';
  return entries.map((entry) => `${entry.name} (${entry.addresses.map((address) => address.display).join(', ')})`).join(', ');
}
