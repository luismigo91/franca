import { isIPv6 } from 'node:net';
import { ConfigError } from '../config/app-config.js';
import { canonicalIp, destinationKey, parseIp } from './addresses.js';
import { describeLocalNames, LOCAL_NAMES_VARIABLE, readLocalNames, type LocalNameEntry } from './local-names.js';
import { isNodeUrlOrigin } from './secret-origin.js';
import type { InstalledSecret } from './secrets.js';

/** Variable con las entradas `NOMBRE=origen` de los secretos. */
export const SECRET_ORIGINS_VARIABLE = 'FRANCA_HTTP_SECRET_ORIGINS';
/** Variable con los pares `dirección:puerto` permitidos. */
export const ALLOWED_DESTINATIONS_VARIABLE = 'FRANCA_HTTP_ALLOWED_DESTINATIONS';
/** Prefijo de las variables con el valor de cada secreto (`FRANCA_SECRET_<NOMBRE>`). */
export const SECRET_VARIABLE_PREFIX = 'FRANCA_SECRET_';

/** Un par permitido ya validado. */
export interface AllowedDestinationEntry {
  /** Forma canónica y legible: `127.0.0.1:8080`, `[::1]:8443`. */
  readonly display: string;
  /** Clave de comparación (`destinationKey`). */
  readonly key: string;
}

/** La configuración validada de la salida http: lo que leen `createSecretStore`, `createAllowedDestinations` y la línea de arranque. */
export interface HttpHostConfig {
  /** Nombre → valor completo de la cabecera y orígenes exactos. Nunca se imprime el valor. */
  readonly secrets: ReadonlyMap<string, InstalledSecret>;
  /** Variables `FRANCA_SECRET_*` ignoradas por no tener origen, con nombre imprimible. */
  readonly ignoredSecretVariables: readonly string[];
  /** Cuántas variables `FRANCA_SECRET_*` ignoradas tienen un nombre que no se imprime. */
  readonly unprintableIgnoredCount: number;
  /** Pares permitidos, en el orden escrito y sin repetidos. */
  readonly allowedDestinations: readonly AllowedDestinationEntry[];
  /** Nombres locales (`FRANCA_HTTP_LOCAL_NAMES`) con sus direcciones de loopback, por orden de primera aparición. */
  readonly localNames: readonly LocalNameEntry[];
}

/** El nombre de un secreto: el mismo patrón que `secretRef` del formato de flujo (un test de paridad lo comprueba). */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** De 1 a 8192 caracteres ASCII visibles, espacios o tabuladores, sin blancos en los extremos. */
const SECRET_VALUE = /^[\x21-\x7E](?:[\x20\t\x21-\x7E]*[\x21-\x7E])?$/;
const MAX_SECRET_LENGTH = 8192;
const PRINTABLE_SECRET_VARIABLE = /^FRANCA_SECRET_[A-Z0-9_]{1,64}$/;
const DECIMAL_OCTET = '(?:0|[1-9][0-9]{0,2})';
const IPV4_PAIR = new RegExp(`^(${DECIMAL_OCTET}(?:\\.${DECIMAL_OCTET}){3}):([1-9][0-9]{0,4})$`);
const IPV6_PAIR = /^\[([^\]]+)\]:([1-9][0-9]{0,4})$/;
const MAX_PORT = 65535;

async function readOriginEntries(value: string | undefined): Promise<[string, string][]> {
  const entries: [string, string][] = [];
  if (value === undefined || value === '') return entries;
  for (const [index, entry] of value.split(',').entries()) {
    const position = index + 1;
    const fail = (reason: string): never => {
      throw new ConfigError(`${SECRET_ORIGINS_VARIABLE} no es válida: la entrada nº ${position} ${reason}.`);
    };
    if (entry === '') fail('está vacía (sobra una coma o un espacio)');
    const equals = entry.indexOf('=');
    const name = equals === -1 ? entry : entry.slice(0, equals);
    if (equals === -1 || !SECRET_NAME.test(name)) fail('debe empezar por NOMBRE= con NOMBRE en mayúsculas, dígitos y guiones bajos (sin espacios)');
    const origin = entry.slice(equals + 1);
    if (!(await isExactOrigin(origin))) {
      fail('debe llevar un origen exacto: esquema http o https, nombre de dominio y puerto solo si no es el de por defecto, sin barra final, ruta, usuario ni mayúsculas');
    }
    entries.push([name, origin]);
  }
  return entries;
}

/** El origen está escrito como su serialización WHATWG y el motor lo admite como origen de una `url`. */
async function isExactOrigin(origin: string): Promise<boolean> {
  let serialized: string;
  try {
    serialized = new URL(origin).origin;
  } catch {
    return false;
  }
  return serialized === origin && (await isNodeUrlOrigin(origin));
}

function readSecrets(env: Record<string, string | undefined>, entries: readonly [string, string][]): Map<string, InstalledSecret> {
  const origins = new Map<string, Set<string>>();
  for (const [name, origin] of entries) {
    const known = origins.get(name);
    if (known) known.add(origin);
    else origins.set(name, new Set([origin]));
  }
  const secrets = new Map<string, InstalledSecret>();
  for (const [name, set] of origins) {
    const variable = `${SECRET_VARIABLE_PREFIX}${name}`;
    const value = env[variable];
    if (value === undefined) throw new ConfigError(`Falta ${variable}: ${SECRET_ORIGINS_VARIABLE} le da orígenes, así que necesita su valor.`);
    if (value.length > MAX_SECRET_LENGTH || !SECRET_VALUE.test(value)) {
      throw new ConfigError(
        `${variable} no es válida: debe tener de 1 a ${MAX_SECRET_LENGTH} caracteres ASCII visibles, espacios o tabuladores, sin blancos al principio ni al final.`,
      );
    }
    secrets.set(name, { value, origins: set });
  }
  return secrets;
}

function readAllowedDestinations(value: string | undefined): AllowedDestinationEntry[] {
  if (value === undefined || value === '') return [];
  const entries: AllowedDestinationEntry[] = [];
  const keys = new Set<string>();
  for (const [index, entry] of value.split(',').entries()) {
    if (entry === '') throw new ConfigError(`${ALLOWED_DESTINATIONS_VARIABLE} no es válida: la entrada nº ${index + 1} está vacía (sobra una coma o un espacio).`);
    const parsed = parseDestination(entry);
    if (parsed === null) {
      throw new ConfigError(
        `${ALLOWED_DESTINATIONS_VARIABLE} no es válida: la entrada nº ${index + 1} debe ser dirección:puerto (IPv4 en decimal con puntos o IPv6 entre corchetes, y un puerto de 1 a 65535, sin ceros a la izquierda ni espacios).`,
      );
    }
    if (keys.has(parsed.key)) continue;
    keys.add(parsed.key);
    entries.push(parsed);
  }
  return entries;
}

function parseDestination(entry: string): AllowedDestinationEntry | null {
  const v4 = IPV4_PAIR.exec(entry);
  const v6 = v4 === null ? IPV6_PAIR.exec(entry) : null;
  const address = v4?.[1] ?? v6?.[1];
  const port = Number(v4?.[2] ?? v6?.[2]);
  if (address === undefined || !(port >= 1 && port <= MAX_PORT)) return null;
  if (v6 !== null && (!isIPv6(address) || address.includes('%'))) return null;
  const parsed = parseIp(address);
  const key = destinationKey(address, port);
  if (parsed === null || key === null) return null;
  const canonical = canonicalIp(parsed);
  return { display: canonical.includes(':') ? `[${canonical}]:${port}` : `${canonical}:${port}`, key };
}

/**
 * Lee y valida la configuración de la salida http del entorno (D11), en este orden:
 * 1. `FRANCA_HTTP_SECRET_ORIGINS`: entradas `NOMBRE=origen` con el origen escrito exacto y admitido por el motor;
 * 2. `FRANCA_SECRET_<NOMBRE>` de cada nombre de los orígenes: de 1 a 8192 caracteres visibles, sin blancos en los extremos;
 * 3. las `FRANCA_SECRET_*` restantes se ignoran;
 * 4. `FRANCA_HTTP_ALLOWED_DESTINATIONS`: pares `dirección:puerto`;
 * 5. `FRANCA_HTTP_LOCAL_NAMES` (`LOCAL_NAMES_VARIABLE`): entradas `nombre=dirección` con nombres `.test` y direcciones de loopback.
 * Ausente o vacía, cada lista queda vacía; una entrada vacía o mal escrita impide arrancar.
 *
 * @param env Variables de entorno (`process.env`).
 * @returns La configuración validada.
 * @throws {ConfigError} Si algo no es válido; el mensaje nombra la variable (y la posición) y nunca un valor.
 */
export async function loadHttpHostConfig(env: Record<string, string | undefined>): Promise<HttpHostConfig> {
  const entries = await readOriginEntries(env[SECRET_ORIGINS_VARIABLE]);
  const secrets = readSecrets(env, entries);
  const ignored = Object.keys(env).filter((name) => name.startsWith(SECRET_VARIABLE_PREFIX) && !secrets.has(name.slice(SECRET_VARIABLE_PREFIX.length)));
  const printable = ignored.filter((name) => PRINTABLE_SECRET_VARIABLE.test(name)).sort();
  return {
    secrets,
    ignoredSecretVariables: printable,
    unprintableIgnoredCount: ignored.length - printable.length,
    allowedDestinations: readAllowedDestinations(env[ALLOWED_DESTINATIONS_VARIABLE]),
    localNames: await readLocalNames(env[LOCAL_NAMES_VARIABLE]),
  };
}

/**
 * La línea de arranque de la salida http: qué secretos hay con sus orígenes, qué variables `FRANCA_SECRET_*` se ignoran y
 * qué destinos se permiten y qué nombres locales hay. Sin ningún valor de secreto.
 *
 * @param config La configuración.
 * @returns Una sola línea.
 */
export function describeHttpHostConfig(config: HttpHostConfig): string {
  const secrets = [...config.secrets].map(([name, secret]) => `${name} (${[...secret.origins].join(', ')})`);
  const ignored = [...config.ignoredSecretVariables];
  if (config.unprintableIgnoredCount > 0) ignored.push(`${config.unprintableIgnoredCount} con un nombre que no se muestra`);
  const destinations = config.allowedDestinations.map((entry) => entry.display);
  return [
    `salida http: secretos ${secrets.length > 0 ? secrets.join(', ') : 'ninguno'}`,
    `variables ignoradas: ${ignored.length > 0 ? ignored.join(', ') : 'ninguna'}`,
    `destinos permitidos: ${destinations.length > 0 ? destinations.join(', ') : 'ninguno'}`,
    `nombres locales: ${describeLocalNames(config.localNames)}`,
  ].join('; ');
}
