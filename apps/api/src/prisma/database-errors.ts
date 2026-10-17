import { Prisma } from '../generated/prisma/client.js';

/** Códigos de Prisma que significan «la base no responde»: sin conexión, conexión cerrada, pool agotado. */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['P1001', 'P1002', 'P1017', 'P2024']);

/**
 * Códigos de Prisma de una `DATABASE_URL` mal configurada: autenticación (`P1000`), base inexistente (`P1003`), usuario
 * sin acceso (`P1010`) y TLS (`P1011`). Para la API son «base no disponible»; el registro nombra el código.
 */
export const DATABASE_CONFIGURATION_CODES: ReadonlySet<string> = new Set(['P1000', 'P1003', 'P1010', 'P1011']);

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

/**
 * Indica si un error significa que Postgres no acepta conexiones o no contesta (para responder 503 y no 500).
 * Solo mira clases, códigos y textos fijos de las librerías, nunca datos de la petición.
 *
 * @param error Lo capturado en el filtro de excepciones.
 * @returns `true` si la base no está disponible.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return isUnavailableRequestError(error);
  // Un Error plano de `pg` (sin `code`): consultas, `create` y transacciones interactivas con un servidor mudo.
  return error instanceof Error && !('code' in error) && PG_MESSAGES.has(error.message);
}

/**
 * SQLSTATE con los que Postgres avisa de que se va o no está listo, y cierra la conexión a mitad de una consulta:
 * `57014` (`canceling statement due to statement timeout`: aborta una sentencia que tardaba demasiado), `57P01`
 * (`terminating connection due to administrator command`: `pg_terminate_backend`, reinicio, conmutación), `57P02`
 * (caída del servidor) y `57P03` (`the database system is starting up`). Llegan con códigos de Prisma distintos
 * (`P2010` en una consulta cruda, `P2039` en el resto), así que se mira el SQLSTATE y no el código de Prisma.
 */
const UNAVAILABLE_SQLSTATES: ReadonlySet<string> = new Set(['57014', '57P01', '57P02', '57P03']);

function isUnavailableRequestError(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (UNAVAILABLE_CODES.has(error.code) || DATABASE_CONFIGURATION_CODES.has(error.code)) return true;
  if (error.code === 'P2028') return error.message.includes(TRANSACTION_START_TIMEOUT);
  const cause = (error.meta as { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } | undefined)
    ?.driverAdapterError?.cause;
  if (cause?.kind === 'DatabaseNotReachable') return true;
  return typeof cause?.originalCode === 'string' && UNAVAILABLE_SQLSTATES.has(cause.originalCode);
}
