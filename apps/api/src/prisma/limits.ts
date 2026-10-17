/** Milisegundos máximos para obtener una conexión: con un servidor que acepta y no contesta, falla a los 5 s. */
export const DATABASE_CONNECT_TIMEOUT_MS = 5000;
/** Milisegundos máximos de una consulta (también esperando un bloqueo de fila): 8 s, menos que `TRANSACTION_TIMEOUT_MS`. */
export const DATABASE_QUERY_TIMEOUT_MS = 8000;
/** Espera máxima de una transacción interactiva por una conexión (coincide con la de conexión). */
export const TRANSACTION_MAX_WAIT_MS = 5000;
/** Duración máxima de una transacción interactiva. */
export const TRANSACTION_TIMEOUT_MS = 10000;
