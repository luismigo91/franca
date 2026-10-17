import { canonicalIp, isGlobalUnicast, parseIp } from './addresses.js';

/** Lo que la salida http sabe de los pares permitidos: solo pregunta por la clave `<canónica>|<puerto>`. */
export interface AllowedDestinations {
  has(key: string): boolean;
}

/**
 * Los pares permitidos de la instalación como conjunto de claves (`destinationKey`).
 *
 * @param entries Las entradas de `FRANCA_HTTP_ALLOWED_DESTINATIONS` ya validadas.
 * @returns El conjunto, que compara direcciones y puertos exactos.
 */
export function createAllowedDestinations(entries: readonly { readonly key: string }[]): AllowedDestinations {
  return new Set(entries.map((entry) => entry.key));
}

/** Una entrada de la resolución tal como la devuelve el resolutor: sin fiarse de su forma. */
export interface ResolvedEntry {
  readonly address: unknown;
  readonly family: unknown;
}

/** Una dirección ya validada a la que se puede conectar. */
export interface ConnectTarget {
  /** Forma canónica: una IPv4 mapeada llega como su IPv4. */
  readonly address: string;
  readonly family: 4 | 6;
}

/** Por qué se bloquea un destino: una dirección interna (gana siempre) o `http://` hacia un destino que no es un par permitido. */
export type BlockReason = 'internal_destination' | 'insecure_transport';

/** La decisión sobre un destino: bloquearlo, con su motivo, o conectar con las direcciones validadas (canónicas, sin repetir, en el orden de la resolución). */
export type DestinationDecision =
  | { readonly kind: 'blocked'; readonly reason: BlockReason }
  | { readonly kind: 'connect'; readonly targets: readonly ConnectTarget[] };

/** Lo que `decideDestination` necesita saber de un intento. */
export interface DestinationInput {
  /** La resolución completa del nombre, en su orden. */
  readonly entries: readonly ResolvedEntry[];
  readonly port: number;
  /** `true` con `https://`. */
  readonly secure: boolean;
  readonly allowed: AllowedDestinations;
}

/**
 * Decide si se puede conectar con el destino, mirando **toda** la resolución:
 * 1. si alguna dirección no es de un par permitido y no es unicast global (o ni siquiera es una dirección) → `blocked`
 *    `internal_destination`;
 * 2. si no, si es `http://` y alguna no es de un par permitido → `blocked` `insecure_transport`;
 * 3. si no, `connect` con todas, canónicas y sin repetir, en el orden de la resolución.
 *
 * Así una resolución mezclada se bloquea entera y nunca se elige qué dirección «vale», y `internal_destination` gana
 * a `insecure_transport`. Una entrada que no se puede analizar cuenta como no global y no permitida (falla cerrado).
 *
 * @param input La resolución, el puerto, el esquema y los pares permitidos.
 * @returns La decisión.
 */
export function decideDestination(input: DestinationInput): DestinationDecision {
  const targets: ConnectTarget[] = [];
  const seen = new Set<string>();
  let hasInternal = false;
  let hasInsecure = false;
  for (const entry of input.entries) {
    const parsed = parseIp(entry.address);
    if (parsed === null || parsed.family !== entry.family) {
      hasInternal = true;
      continue;
    }
    const address = canonicalIp(parsed);
    const isAllowed = input.allowed.has(`${address}|${input.port}`);
    if (!isAllowed && !isGlobalUnicast(parsed)) hasInternal = true;
    if (!isAllowed && !input.secure) hasInsecure = true;
    if (!seen.has(address)) {
      seen.add(address);
      targets.push({ address, family: address.includes(':') ? 6 : 4 });
    }
  }
  if (hasInternal) return { kind: 'blocked', reason: 'internal_destination' };
  if (hasInsecure) return { kind: 'blocked', reason: 'insecure_transport' };
  return { kind: 'connect', targets };
}
