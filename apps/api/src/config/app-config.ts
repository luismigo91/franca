/** Token de inyección de la configuración ya validada. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  /** Dirección de escucha: siempre de bucle local. */
  host: string;
  /** Puerto de escucha; 0 elige uno libre. */
  port: number;
  /** Cadena de conexión a Postgres. Nunca se imprime. */
  databaseUrl: string;
}

/** Configuración inválida. Su mensaje nombra la variable y nunca el valor recibido. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** `HOST` por defecto y únicos valores admitidos mientras la API no tenga autenticación. */
const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1']);
const DEFAULT_PORT = 3001;
const MAX_PORT = 65535;

/**
 * Lee y valida la configuración del entorno.
 *
 * `HOST` y `PORT` ausentes (`undefined`) toman su valor por defecto; definidas, deben cumplir la regla aunque
 * estén vacías: `listen(port, '')` escucharía en todas las interfaces y `localhost` puede resolver a una sola
 * familia, así que `HOST` solo admite los textos exactos de bucle local IPv4 e IPv6.
 *
 * @param env Variables de entorno (`process.env`).
 * @returns La configuración validada.
 * @throws {ConfigError} Si alguna variable no es válida; el mensaje nombra la variable, nunca su valor.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  return { host: readHost(env.HOST), port: readPort(env.PORT), databaseUrl: readDatabaseUrl(env.DATABASE_URL) };
}

function readHost(value: string | undefined): string {
  if (value === undefined) return DEFAULT_HOST;
  if (LOOPBACK_HOSTS.has(value)) return value;
  throw new ConfigError(
    'HOST no es válido: la API de Franca no tiene autenticación y solo puede escuchar en la dirección de bucle local ' +
      '(IPv4 o IPv6, texto exacto, sin espacios ni nombres de host). Exponerla en otra dirección exige antes añadir autenticación.',
  );
}

function readPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = /^[0-9]{1,5}$/.test(value) ? Number(value) : Number.NaN;
  if (port <= MAX_PORT) return port;
  throw new ConfigError('PORT no es válido: debe ser un entero decimal de 0 a 65535, sin espacios (0 elige un puerto libre).');
}

function readDatabaseUrl(value: string | undefined): string {
  if (value) return value;
  throw new ConfigError('Falta DATABASE_URL: la cadena de conexión a Postgres. En local, arranca la base con `docker compose up -d`.');
}
