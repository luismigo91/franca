/** Cómo debe resolver el proveedor un error de la API. */
export type ErrorKind = 'not_configured' | 'failed';

/**
 * Clasifica un error del SDK **solo por su `status`** (401, 403 y 404 son de configuración: credenciales
 * o modelo que la cuenta no tiene; todo lo demás, un fallo del turno). Nunca se lee `message`, el cuerpo
 * ni las cabeceras: pueden llevar datos. Se usa la propiedad y no `instanceof` porque un cliente
 * inyectado puede venir de otra copia del SDK.
 *
 * @param error Lo que lanzó o rechazó el cliente (cualquier valor).
 */
export function classifyError(error: unknown): ErrorKind {
  let status: unknown;
  try {
    status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  } catch {
    return 'failed';
  }
  return status === 401 || status === 403 || status === 404 ? 'not_configured' : 'failed';
}
