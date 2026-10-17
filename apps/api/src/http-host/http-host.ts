import type { HttpAttemptResult, HttpCapability, HttpRequest } from '@franca/engine';
import { parseIp } from './addresses.js';
import { abortAfter, attemptBudget } from './attempt-budget.js';
import { decideDestination, type AllowedDestinations, type ResolvedEntry } from './destination-policy.js';
import type { LocalNames } from './local-names.js';
import type { HttpNetwork } from './network.js';
import type { HttpNotices } from './notices.js';
import type { WireHeader } from './request-headers.js';
import type { SecretStore } from './secrets.js';
import { bareHostname, portOf, sendRequest } from './transport.js';

/** Lo que la salida http necesita saber de un avance: a qué conversación pertenece y cuándo acaba su plazo. */
export interface AdvanceContext {
  readonly conversationId: string;
  /** Instante (ms del reloj de la API) en que acaba el plazo del avance. */
  readonly deadlineMs: number;
  /** Reloj de la API, en milisegundos. */
  now(): number;
}

/** La salida http de producción, de la que cada avance saca su capacidad `http`. */
export interface HttpHost {
  /** La capacidad `http` de un avance. */
  forAdvance(context: AdvanceContext): HttpCapability;
}

/** Las piezas de las que depende `createHttpHost`: todas inyectables en un test. */
export interface HttpHostDeps {
  /** Los secretos de este host (la instalación en la API; un tenant en el arnés). */
  readonly secrets: SecretStore;
  readonly allowed: AllowedDestinations;
  readonly network: HttpNetwork;
  readonly notices: HttpNotices;
  /**
   * Nombres locales (`FRANCA_HTTP_LOCAL_NAMES`): su resolución son sus direcciones de loopback, sin preguntar al resolutor.
   * Ausente, no hay ninguno; la política de destinos se aplica igual.
   */
  readonly localNames?: LocalNames;
}

const NETWORK_ERROR_NOT_SENT = (): HttpAttemptResult => ({ kind: 'network_error', requestSent: false });
const NETWORK_ERROR_SENT = (): HttpAttemptResult => ({ kind: 'network_error', requestSent: true });

/** Una resolución: las entradas, un fallo, o el plazo vencido. */
type Resolution = { readonly kind: 'entries'; readonly entries: readonly ResolvedEntry[] } | { readonly kind: 'failed' } | { readonly kind: 'aborted' };

/** Un host literal (IP entre corchetes o escrita) se resuelve a sí mismo; el motor no lo deja pasar, es solo defensa. */
function literalEntries(url: URL): ResolvedEntry[] | null {
  const hostname = bareHostname(url);
  const parsed = parseIp(hostname);
  return parsed === null ? null : [{ address: hostname, family: parsed.family }];
}

/**
 * Resuelve el nombre de la `url` en cada intento, en carrera con el plazo. Un nombre local se resuelve a sus direcciones sin
 * preguntar al resolutor (el resultado entra después en la política de destinos como cualquier otra resolución). `lookup` no se puede cancelar: al vencer el
 * intento se abandona su promesa (con su `catch`) y el hilo del sistema termina cuando responda.
 */
async function resolveName(network: HttpNetwork, url: URL, signal: AbortSignal, localNames?: LocalNames): Promise<Resolution> {
  const literal = literalEntries(url);
  if (literal !== null) return { kind: 'entries', entries: literal };
  const local = localNames?.lookup(url.hostname);
  if (local !== undefined) return { kind: 'entries', entries: local };
  const lookup = (async (): Promise<Resolution> => {
    try {
      const answers: unknown = await network.resolver.lookup(url.hostname);
      return Array.isArray(answers) && answers.length > 0 ? { kind: 'entries', entries: answers as ResolvedEntry[] } : { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  })();
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<Resolution>((resolve) => {
    onAbort = () => resolve({ kind: 'aborted' });
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([lookup, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Los avisos no pueden cambiar el resultado de un intento: un registro que falla se ignora. */
function notify(send: () => void): void {
  try {
    send();
  } catch {
    // Se ignora a propósito: el aviso es de operación, el resultado ya está decidido.
  }
}

/**
 * La salida http de producción. Cada intento comprueba, en este orden y deteniéndose en la primera que falle: la `url`,
 * los secretos de sus cabeceras (`missing_secret`, sin resolver), el plazo del avance (`timeout`, sin resolver), la
 * resolución del nombre, la política de destinos (`blocked`, sin conectar), la conexión y TLS, y el envío y la lectura.
 * El `timeoutMs` (recortado por el plazo) cuenta desde el primer paso de la resolución. No hay espera entre intentos.
 *
 * @param deps Secretos, pares permitidos, red, avisos y, si los hay, nombres locales.
 * @returns El host, del que cada avance saca su capacidad `http`.
 */
export function createHttpHost(deps: HttpHostDeps): HttpHost {
  async function run(context: AdvanceContext, request: HttpRequest): Promise<HttpAttemptResult> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return NETWORK_ERROR_NOT_SENT();
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return NETWORK_ERROR_NOT_SENT();

    const headers: WireHeader[] = [];
    for (const header of request.headers) {
      if ('value' in header) {
        headers.push([header.name, header.value]);
        continue;
      }
      const found = deps.secrets.lookup(header.secret, url.origin);
      if (found.kind !== 'found') {
        notify(() => deps.notices.missingSecret({ conversationId: context.conversationId, nodeId: request.nodeId, secret: header.secret, reason: found.kind }));
        return { kind: 'missing_secret' };
      }
      headers.push([header.name, found.value]);
    }

    const budgetMs = attemptBudget(request.timeoutMs, context.deadlineMs - context.now());
    if (budgetMs <= 0) return { kind: 'timeout' };
    const controller = new AbortController();
    const cancelTimer = abortAfter(controller, budgetMs);
    try {
      const resolution = await resolveName(deps.network, url, controller.signal, deps.localNames);
      if (resolution.kind === 'aborted') return { kind: 'timeout' };
      if (resolution.kind === 'failed') return NETWORK_ERROR_NOT_SENT();

      const decision = decideDestination({ entries: resolution.entries, port: portOf(url), secure: url.protocol === 'https:', allowed: deps.allowed });
      if (decision.kind === 'blocked') {
        notify(() => deps.notices.blocked({ conversationId: context.conversationId, nodeId: request.nodeId, reason: decision.reason }));
        return { kind: 'blocked' };
      }

      const outcome = await sendRequest({ method: request.method, url, headers, body: request.body, targets: decision.targets, network: deps.network, signal: controller.signal });
      switch (outcome.kind) {
        case 'response':
          return { kind: 'response', status: outcome.status, body: outcome.body };
        case 'response_too_large':
          return { kind: 'response_too_large' };
        case 'network_error':
          return { kind: 'network_error', requestSent: outcome.requestSent };
        case 'aborted':
          return { kind: 'timeout' };
      }
    } finally {
      cancelTimer();
    }
  }

  return {
    forAdvance(context) {
      return async (request) => {
        try {
          return await run(context, request);
        } catch {
          // Un fallo inesperado de la propia salida: la promesa nunca se rechaza y no se sabe si algo llegó a salir.
          return NETWORK_ERROR_SENT();
        }
      };
    },
  };
}
