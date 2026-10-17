import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { isIP, type Socket } from 'node:net';
import { checkServerIdentity, connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { HttpMethod } from '@franca/engine';
import type { ConnectTarget } from './destination-policy.js';
import type { HttpNetwork } from './network.js';
import { buildRequestHeaders, requestPath, type WireHeader } from './request-headers.js';
import { readResponseBody } from './response-body.js';

/** Tope de las cabeceras de la respuesta, explícito para no depender de `NODE_OPTIONS=--max-http-header-size`. */
const MAX_HEADER_SIZE = 16_384;

// Las dos defensas de TLS salen de una sola constante, contiguas (D6): un solo cambio las quita a la vez.
const VERIFY_PEER = true;
const peerVerification = () => ({ rejectUnauthorized: VERIFY_PEER });
const isPeerVerified = (socket: TLSSocket): boolean => !VERIFY_PEER || socket.authorized === true;

export interface TransportInput {
  readonly method: HttpMethod;
  readonly url: URL;
  /** Las cabeceras del nodo con los secretos ya resueltos. */
  readonly headers: readonly WireHeader[];
  readonly body: string | null;
  /** Direcciones ya validadas por la política, en el orden de la resolución. */
  readonly targets: readonly ConnectTarget[];
  readonly network: HttpNetwork;
  /** Se aborta al vencer el plazo del intento: corta conexión, TLS, envío y lectura. */
  readonly signal: AbortSignal;
}

export type TransportResult =
  | { readonly kind: 'response'; readonly status: number; readonly body: string }
  | { readonly kind: 'response_too_large' }
  | { readonly kind: 'network_error'; readonly requestSent: boolean }
  /** El plazo del intento venció. */
  | { readonly kind: 'aborted' };

const ABORTED: TransportResult = { kind: 'aborted' };
const NOT_SENT: TransportResult = { kind: 'network_error', requestSent: false };
const SENT_AND_FAILED: TransportResult = { kind: 'network_error', requestSent: true };
const ignoreError = (): void => undefined;

/** El puerto de la `url`, con el de por defecto de su esquema. */
export function portOf(url: URL): number {
  return url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
}

/** `hostname` sin corchetes si es una IPv6 literal. */
const bareHostname = (url: URL): string => (url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname);

/**
 * Hace **un** intento sobre las direcciones ya validadas: abre una conexión por intento (sin agente ni *pool*), la verifica
 * (TLS contra el nombre de la `url`), envía la petición con `node:http` sobre ese socket, lee la respuesta con los límites del
 * host y destruye todo al terminar. Pasa a la siguiente dirección solo si la anterior falla antes de enviar nada (TCP o TLS).
 * Nunca rechaza.
 *
 * @param input Petición, direcciones, red y señal de plazo.
 * @returns La respuesta, `response_too_large`, un fallo de red (con `requestSent`) o `aborted` si venció el plazo.
 */
export async function sendRequest(input: TransportInput): Promise<TransportResult> {
  const wire = buildRequestHeaders({ method: input.method, url: input.url, headers: input.headers, body: input.body });
  const opened = new Set<Socket>();
  try {
    for (const target of input.targets) {
      if (input.signal.aborted) return ABORTED;
      const socket = await connectTo(input, target, opened);
      if (socket === null) continue;
      return input.signal.aborted ? ABORTED : await exchange(input, wire, socket);
    }
    return input.signal.aborted ? ABORTED : NOT_SENT;
  } catch {
    return input.signal.aborted ? ABORTED : SENT_AND_FAILED;
  } finally {
    for (const socket of opened) socket.destroy();
  }
}

/** Abre la conexión TCP y, con `https:`, la envuelve en TLS verificado. `null` si falla antes de poder enviar. */
function connectTo(input: TransportInput, target: ConnectTarget, opened: Set<Socket>): Promise<Socket | null> {
  return new Promise<Socket | null>((resolve) => {
    let socket: Socket;
    try {
      socket = input.network.opener.open({ address: target.address, family: target.family, port: portOf(input.url) });
    } catch {
      resolve(null);
      return;
    }
    opened.add(socket);
    socket.on('error', ignoreError);
    const secure = input.url.protocol === 'https:';
    let ready: Socket = socket;
    let settled = false;
    const finish = (value: Socket | null): void => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener('abort', onAbort);
      if (value === null) {
        ready.destroy();
        socket.destroy();
      }
      resolve(value);
    };
    const onAbort = (): void => finish(null);
    input.signal.addEventListener('abort', onAbort, { once: true });
    const fail = (): void => finish(null);
    socket.once('close', fail);

    if (!secure) {
      if (!socket.connecting && !socket.destroyed) finish(socket);
      else socket.once('connect', () => finish(socket));
      return;
    }
    const hostname = bareHostname(input.url);
    let tls: TLSSocket;
    try {
      tls = tlsConnect({
        socket,
        // Un host que fuera una IP literal (inalcanzable desde el motor) no lleva SNI y se verifica contra la IP.
        ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
        ...peerVerification(),
        checkServerIdentity: (_host, certificate) => checkServerIdentity(hostname, certificate),
        minVersion: 'TLSv1.2',
        ALPNProtocols: ['http/1.1'],
        ...(input.network.ca ? { ca: [...input.network.ca] } : {}),
      });
    } catch {
      finish(null);
      return;
    }
    ready = tls;
    opened.add(tls);
    tls.on('error', ignoreError);
    tls.once('close', fail);
    tls.once('secureConnect', () => finish(isPeerVerified(tls) ? tls : null));
  });
}

/** Envía la petición sobre un socket ya conectado y verificado, y lee la respuesta. */
function exchange(input: TransportInput, wire: readonly WireHeader[], socket: Socket): Promise<TransportResult> {
  return new Promise<TransportResult>((resolve) => {
    let settled = false;
    let gotResponse = false;
    let request: ClientRequest | undefined;
    const finish = (result: TransportResult): void => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => {
      request?.destroy();
      socket.destroy();
      finish(ABORTED);
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
    try {
      // Sin `agent` (ni `agent: false`, que ignora `createConnection`): Node usa este socket y no hay pool ni proxy del entorno.
      request = httpRequest({
        method: input.method,
        path: requestPath(input.url),
        headers: wire.flat(),
        setHost: false,
        createConnection: () => socket,
        insecureHTTPParser: false,
        maxHeaderSize: MAX_HEADER_SIZE,
      });
    } catch {
      finish(SENT_AND_FAILED);
      return;
    }
    request.on('error', () => {
      if (!gotResponse) finish(SENT_AND_FAILED);
    });
    // Un `101` o un cierre del servidor tras la petición cierran sin `response` ni `error`: no se espera al plazo.
    request.on('close', () => {
      if (!gotResponse) finish(SENT_AND_FAILED);
    });
    request.on('response', (response: IncomingMessage) => {
      gotResponse = true;
      const status = response.statusCode ?? 0;
      if (status < 200 || status > 599) {
        response.destroy();
        socket.destroy();
        finish(SENT_AND_FAILED);
        return;
      }
      void readResponseBody(response, { contentEncoding: response.headers['content-encoding'], contentLength: response.headers['content-length'] }).then((outcome) => {
        if (outcome.kind === 'text') finish({ kind: 'response', status, body: outcome.text });
        else finish(outcome.kind === 'too_large' ? { kind: 'response_too_large' } : SENT_AND_FAILED);
      });
    });
    request.end(input.body ?? undefined);
  });
}
