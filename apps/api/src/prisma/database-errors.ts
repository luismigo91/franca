import { Prisma } from '../generated/prisma/client.js';

/**
 * Códigos de Prisma de conectividad: sin conexión (`P1001`, `P1002`), tiempo de socket (`P1008`), conexión cerrada
 * (`P1017`), pool agotado (`P2024`) y demasiadas conexiones (`P2037`, SQLSTATE `53300`).
 */
const CONNECTIVITY_CODES: ReadonlySet<string> = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037']);

/**
 * Códigos de Prisma de una `DATABASE_URL` mal configurada: autenticación (`P1000`), base inexistente (`P1003`), usuario
 * sin acceso (`P1010`) y TLS (`P1011`). Para la API son «base no disponible»; el registro nombra el código.
 */
export const DATABASE_CONFIGURATION_CODES: ReadonlySet<string> = new Set(['P1000', 'P1003', 'P1010', 'P1011']);

/**
 * `code` de un error de socket de Node que el adaptador de `pg` no traduce y Prisma entrega tal cual (como `code` de un
 * `PrismaClientKnownRequestError` sin `meta.driverAdapterError`, o en un `Error` plano de una transacción interactiva).
 */
const SOCKET_ERRNOS: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** `P2028` es «base no disponible» solo con este mensaje; el otro `P2028` (transacción caducada) es un fallo del código. */
const TRANSACTION_START_TIMEOUT = 'Unable to start a transaction in the given time';

/**
 * Mensajes exactos de `pg`/`pg-pool` cuando la conexión no se logra, se corta o la consulta no contesta.
 * Comparar el texto es frágil ante una subida de `pg`: los e2e producen estas formas de verdad y fallan si cambian.
 */
const PG_MESSAGES: ReadonlySet<string> = new Set([
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
  'timeout exceeded when trying to connect',
  'Query read timeout',
]);

/** `kind` de `meta.driverAdapterError.cause` que significan «la base no responde». */
const UNAVAILABLE_KINDS: ReadonlySet<string> = new Set(['DatabaseNotReachable', 'SocketTimeout', 'TooManyConnections']);

/**
 * SQLSTATE con los que Postgres avisa de que no atiende: la clase `08` (excepciones de conexión), `53300` (demasiadas
 * conexiones), `57014` (`canceling statement due to statement timeout`: aborta una sentencia que tardaba demasiado) y
 * `57P01`-`57P03` (`terminating connection due to administrator command`, caída del servidor, arrancando). Llegan con
 * códigos de Prisma distintos (`P2010` en una consulta cruda, `P2039` en el resto), así que se mira el SQLSTATE.
 * Los demás de clase 53 o 57 (`53100` disco lleno, `57P04`) y los de fallos del código (`23505`, `40001`) no entran.
 */
function isUnavailableSqlState(sqlState: string): boolean {
  return sqlState.startsWith('08') || sqlState === '53300' || sqlState === '57014' || /^57P0[123]$/.test(sqlState);
}

const hasCode = (code: unknown, ...sets: ReadonlySet<string>[]): boolean => typeof code === 'string' && sets.some((set) => set.has(code));

/**
 * Indica si un error significa que Postgres no acepta conexiones o no contesta (para responder 503 y no 500).
 * Solo mira clases, códigos y textos fijos de las librerías, nunca datos de la petición.
 *
 * @param error Lo capturado en el filtro de excepciones.
 * @returns `true` si la base no está disponible.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  // Con el adaptador de `pg` lo lanza sobre todo el runtime por un despliegue roto (un 500): solo cuenta su `errorCode`.
  if (error instanceof Prisma.PrismaClientInitializationError) return hasCode(error.errorCode, CONNECTIVITY_CODES, DATABASE_CONFIGURATION_CODES);
  if (error instanceof Prisma.PrismaClientKnownRequestError) return isUnavailableRequestError(error);
  if (!(error instanceof Error)) return false;
  // Un `Error` de `pg` sin `code` (servidor mudo) o con el `code` de un errno de socket (transacción interactiva).
  const code = (error as { code?: unknown }).code;
  return code === undefined ? PG_MESSAGES.has(error.message) : hasCode(code, SOCKET_ERRNOS);
}

function isUnavailableRequestError(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (hasCode(error.code, CONNECTIVITY_CODES, DATABASE_CONFIGURATION_CODES, SOCKET_ERRNOS)) return true;
  if (error.code === 'P2028') return error.message.includes(TRANSACTION_START_TIMEOUT);
  const cause = (error.meta as { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } | undefined)
    ?.driverAdapterError?.cause;
  return hasCode(cause?.kind, UNAVAILABLE_KINDS) || (typeof cause?.originalCode === 'string' && isUnavailableSqlState(cause.originalCode));
}
