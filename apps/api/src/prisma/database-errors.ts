import { Prisma } from '../generated/prisma/client.js';

/** Códigos de Prisma que significan «la base no responde»: sin conexión, conexión cerrada, pool agotado. */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['P1001', 'P1002', 'P1017', 'P2024']);

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

/** SQLSTATE de `canceling statement due to statement timeout`: Postgres abortó una sentencia que tardaba demasiado. */
const STATEMENT_TIMEOUT_SQLSTATE = '57014';

function isUnavailableRequestError(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (UNAVAILABLE_CODES.has(error.code)) return true;
  if (error.code === 'P2028') return error.message.includes(TRANSACTION_START_TIMEOUT);
  const cause = (error.meta as { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } | undefined)
    ?.driverAdapterError?.cause;
  // P2010 con 57014: una sentencia (por ejemplo, una espera de bloqueo de fila) superó `statement_timeout`.
  return cause?.kind === 'DatabaseNotReachable' || cause?.originalCode === STATEMENT_TIMEOUT_SQLSTATE;
}
