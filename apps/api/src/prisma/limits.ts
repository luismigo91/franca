/** Milisegundos máximos para obtener una conexión: con un servidor que acepta y no contesta, falla a los 5 s. */
export const DATABASE_CONNECT_TIMEOUT_MS = 5000;
/**
 * Milisegundos máximos de una consulta, medidos por el cliente (`query_timeout` de `pg`): 4 s. Es el corte para un
 * servidor que deja de contestar a mitad de una consulta. Prisma envía el `ROLLBACK` de una transacción interactiva por
 * la misma conexión muda, y ese `ROLLBACK` espera otro `query_timeout` entero: el peor caso es el doble (8 s), y con
 * 8 s eran 16 s, más de los 10 s del contrato («Base de datos no disponible»). Menos que `TRANSACTION_TIMEOUT_MS`.
 */
export const DATABASE_QUERY_TIMEOUT_MS = 4000;
/**
 * Milisegundos máximos de una sentencia, medidos por Postgres (`statement_timeout`), un poco antes que el corte del
 * cliente. Con solo `query_timeout`, una consulta que espera un bloqueo falla en el cliente pero la sentencia sigue
 * ocupando la conexión del servidor y el `ROLLBACK` se encola detrás. Si aborta el servidor, la conexión queda libre
 * y el `ROLLBACK` es inmediato. Siempre menor que `DATABASE_QUERY_TIMEOUT_MS`.
 */
export const DATABASE_STATEMENT_TIMEOUT_MS = 3500;
/** Espera máxima de una transacción interactiva por una conexión (coincide con la de conexión). */
export const TRANSACTION_MAX_WAIT_MS = 5000;
/** Duración máxima de una transacción interactiva. */
export const TRANSACTION_TIMEOUT_MS = 10000;
