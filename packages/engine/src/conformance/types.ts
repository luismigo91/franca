import type { HttpCapability } from '../types.js';

/** Comportamiento de un servidor que levanta el arnés. */
export type ServerBehaviour =
  | { kind: 'respond'; status: number; body?: string; headers?: Readonly<Record<string, string>> }
  | { kind: 'redirect'; status: 301 | 302 | 303 | 307 | 308; location: string }
  /** Escribe sin fin hasta que el cliente cierra la conexión. */
  | { kind: 'endless-body'; encoding: 'identity' | 'gzip' | 'deflate' | 'br' | 'x-franca-test' }
  /** Cuerpo finito de `a` comprimido (menos de 64 KiB en red) que descomprime a `decompressedBytes`. */
  | { kind: 'compressed-body'; encoding: 'gzip' | 'deflate' | 'br'; decompressedBytes: number }
  /** Acepta la conexión y la petición y nunca responde. */
  | { kind: 'stall-headers' }
  /** Envía las cabeceras y deja de escribir. */
  | { kind: 'stall-body' }
  /** Envía las cabeceras y un byte del cuerpo cada `intervalMs`, sin terminar. */
  | { kind: 'drip-body'; intervalMs: number }
  | { kind: 'set-cookie'; cookie: string };

export interface ServeOptions {
  readonly tls?: 'none' | 'trusted' | 'untrusted';
}

export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  /** Nombres en minúsculas. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface ConformanceServer {
  /** Origen con un nombre DNS que el arnés resuelve a la dirección del servidor (p. ej. `http://srv-1.conformance.test:41234`). */
  readonly origin: string;
  /** Par permitido para el host: la dirección (fuera de `CONFORMANCE_INTERNAL_ADDRESSES`) y el puerto en que escucha. */
  readonly address: string;
  readonly port: number;
  received(): Promise<readonly ReceivedRequest[]>;
}

export interface Connection {
  readonly address: string;
  readonly port: number;
}

/**
 * Lo que implementa quien ofrece el host de producción para pasar la suite: servidores locales
 * reales, un resolutor, una lista de permitidos por par dirección y puerto, un almacén de secretos
 * y un registro, todos inyectables. El motor solo define el contrato; no lo implementa.
 */
export interface HostConformanceHarness {
  /** El `http` del host bajo prueba para el tenant dado, con el resolutor, la lista de permitidos y el almacén de secretos del arnés. */
  http(tenant?: string): HttpCapability;
  /** Levanta un servidor y añade su par (dirección, puerto) a la lista de permitidos del host. Nada más se permite. */
  serve(behaviour: ServerBehaviour, options?: ServeOptions): Promise<ConformanceServer>;
  /** `name` resuelve a cada lista de direcciones en resoluciones sucesivas (la última se repite). Una lista puede mezclar direcciones. */
  resolve(name: string, answers: readonly (readonly string[])[]): Promise<void>;
  /** Puerto en el que no escucha nada y que no está en ningún par permitido. */
  readonly blockedPort: number;
  /** Par permitido en el que nadie escucha (la conexión se rechaza) y un origen cuyo nombre resuelve a él. */
  refusing(): Promise<{ readonly origin: string; readonly address: string; readonly port: number }>;
  /** Pares a los que el host intentó conectar desde el último `reset`. */
  connectionsTo(): Promise<readonly Connection[]>;
  setSecret(name: string, value: string, origins: readonly string[], tenant?: string): Promise<void>;
  /** Líneas que el host registró desde el último `reset`. */
  logs(): Promise<readonly string[]>;
  /** Reloj del arnés en ms (el motor no tiene reloj). */
  now(): number;
  /** Tolerancia de los casos de tiempo: la fija el entorno. */
  readonly timeToleranceMs: number;
  /**
   * Espera real de `ms` (la pone el arnés: el motor no tiene temporizadores). La usa `call` para su
   * espera límite y la cancela con `signal` en cuanto responde el host: el arnés debe liberar su
   * temporizador (y puede resolver o rechazar la promesa) al abortarse.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  reset(): Promise<void>;
}

export interface HostConformanceCase {
  /** Estable, en kebab-case. */
  readonly id: string;
  /** Título exacto del requisito «Host de producción: …» de la spec. */
  readonly requirement: string;
  /** Título exacto del `#### Scenario` de la spec. */
  readonly scenario: string;
  /** @returns Los fallos encontrados; `[]` si pasa. Los mensajes no incluyen valores de secretos ni datos personales. */
  run(harness: HostConformanceHarness): Promise<string[]>;
}
