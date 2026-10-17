import type { Flow } from '@franca/spec';

/** Milisegundos que dura una reclamación (D4): cubre el peor avance (~150 s) con margen y desbloquea una API reiniciada. */
export const CLAIM_TTL_MS = 300_000;
/** Milisegundos desde el inicio de un avance durante los que se piden turnos `llm` al proveedor y se hacen intentos `http`. */
export const LLM_WINDOW_MS = 90_000;
/** Plazo de inactividad por defecto cuando el flujo no define `settings.sessionTimeoutMinutes`: un día. */
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 1440;
/** Tope del plazo de inactividad: un año. El esquema no tiene máximo y `1e300` es un entero válido. */
export const MAX_SESSION_TIMEOUT_MINUTES = 525_600;

const MS_PER_MINUTE = 60_000;

/**
 * Instante en que caduca una conversación en espera.
 *
 * @param updatedAt Instante del último avance aplicado.
 * @param flow El flujo que el motor acaba de aceptar.
 * @returns `updatedAt` más `min(settings.sessionTimeoutMinutes ?? 1440, 525600)` minutos.
 */
export function expiresAtOf(updatedAt: Date, flow: Pick<Flow, 'settings'>): Date {
  const minutes = Math.min(flow.settings?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES, MAX_SESSION_TIMEOUT_MINUTES);
  return new Date(updatedAt.getTime() + minutes * MS_PER_MINUTE);
}

/**
 * Indica si una reclamación sigue viva: hay testigo y pasó menos de `CLAIM_TTL_MS` desde que se tomó.
 *
 * @param claimToken Testigo de la reclamación, o `null`.
 * @param claimedAt Instante en que se tomó, o `null`.
 * @param now Instante actual del reloj de la API.
 * @returns `true` si la reclamación está activa.
 */
export function isClaimActive(claimToken: string | null, claimedAt: Date | null, now: Date): boolean {
  return claimToken !== null && claimedAt !== null && now.getTime() - claimedAt.getTime() < CLAIM_TTL_MS;
}

/**
 * Indica si una conversación en espera caducó: `now >= expiresAt`.
 *
 * @param expiresAt Instante de caducidad, o `null` (conversación terminada o fallida: nunca caduca).
 * @param now Instante actual.
 * @returns `true` si caducó.
 */
export function hasExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}
