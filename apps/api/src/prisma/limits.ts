/** Milisegundos máximos para obtener una conexión: con un servidor que acepta y no contesta, falla a los 5 s. */
export const DATABASE_CONNECT_TIMEOUT_MS = 5000;
/**
 * Milisegundos máximos de una consulta, medidos por el cliente (`query_timeout` de `pg`): 8 s, menos que
 * `TRANSACTION_TIMEOUT_MS`. Es el corte para un servidor que deja de contestar a mitad de una consulta.
 */
export const DATABASE_QUERY_TIMEOUT_MS = 8000;
/**
 * Milisegundos máximos de una sentencia, medidos por Postgres (`statement_timeout`), un poco antes que el corte del
 * cliente. Con solo `query_timeout`, una consulta que espera un bloqueo de fila falla a los 8 s pero la conexión sigue
 * ocupada con la sentencia: el `ROLLBACK` de la transacción espera otros 8 s (medido: 16 s en total, más de los 10 s
 * del contrato). Si aborta el servidor, la conexión queda libre y el `ROLLBACK` es inmediato.
 */
export const DATABASE_STATEMENT_TIMEOUT_MS = 7500;
/** Espera máxima de una transacción interactiva por una conexión (coincide con la de conexión). */
export const TRANSACTION_MAX_WAIT_MS = 5000;
/** Duración máxima de una transacción interactiva. */
export const TRANSACTION_TIMEOUT_MS = 10000;
