import * as dns from 'node:dns';
import * as net from 'node:net';
import type { Socket } from 'node:net';

/**
 * Lo que devuelve `dns.promises.lookup` con `all: true`, sin tocar: puede rechazar, venir vacío o traer basura. Quien lo
 * usa (`http-host.ts`) no se fía de su forma.
 */
export interface Resolver {
  lookup(hostname: string): Promise<readonly { address: unknown; family: unknown }[]>;
}

/** Abre una conexión TCP con una dirección IP literal ya validada. Devuelve el socket sin esperar a `connect`. */
export interface SocketOpener {
  open(target: { address: string; family: 4 | 6; port: number }): Socket;
}

/**
 * La costura de red de la salida http (D3): lo único que un test puede sustituir. Ninguna de las dos piezas tiene
 * lógica; el orden, la política, TLS, el cliente HTTP y los límites son código de producción en cualquier ejecución.
 */
export interface HttpNetwork {
  readonly resolver: Resolver;
  readonly opener: SocketOpener;
  /** Autoridades TLS que sustituyen a las de Node. `undefined` en producción: solo la red del test las trae. */
  readonly ca?: readonly string[];
}

/** Las opciones exactas de la resolución de producción: todas las direcciones, en el orden del sistema. */
export const LOOKUP_OPTIONS = { all: true, order: 'verbatim' } as const;

/** Resolutor de `net.connect` que siempre falla: con una IP literal Node no lo llama, y si algún día lo hiciera, no resolvería nada. */
const failingLookup: net.LookupFunction = (_hostname, _options, callback) => {
  callback(new Error('la salida http no resuelve nombres al conectar'), '', 4);
};

/**
 * Une `lookup` y `connect` a la costura sin lógica propia: `lookup(hostname, LOOKUP_OPTIONS)` y `connect` a la IP
 * literal con `autoSelectFamily: false` y un resolutor que falla.
 *
 * @param deps `dns.promises.lookup` y `net.connect` (o espías, en un unit).
 * @returns La red, sin autoridades TLS propias.
 */
export function createSystemNetwork(deps: { lookup: typeof dns.promises.lookup; connect: typeof net.connect }): HttpNetwork {
  return {
    resolver: { lookup: (hostname) => deps.lookup(hostname, LOOKUP_OPTIONS) },
    opener: {
      open: ({ address, family, port }) => deps.connect({ host: address, port, family, autoSelectFamily: false, noDelay: true, lookup: failingLookup }),
    },
  };
}

/** La red de producción. No lee el entorno. */
export function systemNetwork(): HttpNetwork {
  return createSystemNetwork({ lookup: dns.promises.lookup, connect: net.connect });
}
