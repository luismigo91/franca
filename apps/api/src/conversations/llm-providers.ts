import type { LlmCapability } from '@franca/engine';
import { createAnthropicClient, createAnthropicProvider } from '@franca/llm-anthropic';
import type { ConversationsConfig } from './conversations-config.js';

/** Token de inyección de los proveedores `llm` (nombre → capacidad): los tests lo sustituyen. */
export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');

/** Origen de la API de Claude: lo único a lo que la API de Franca envía peticiones. */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com';
/** Versión de la API de Mensajes que fija la puerta de salida; un test la compara con la que envía el SDK. */
export const ANTHROPIC_API_VERSION = '2023-06-01';

const MESSAGES_PATH = '/v1/messages';
/** Consulta de la llamada con cabeceras beta (`client.beta.messages.create`); la otra no lleva consulta. */
const BETA_QUERY = '?beta=true';

/** Salida a la red del cliente: `fetch` en producción; un registro que no envía nada en los unit. */
export type Send = typeof fetch;

/** Rechazo de la puerta. Texto fijo: nunca lleva la URL ni cabeceras. */
const DENIED = 'petición a Claude no permitida';

/**
 * La URL de la petición si es exactamente la de la API de Mensajes (`POST https://api.anthropic.com/v1/messages`,
 * con consulta vacía o `?beta=true`), o `undefined`.
 */
function allowedSearch(input: unknown): string | undefined {
  if (typeof input !== 'string' && !(input instanceof URL)) return undefined;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  const hasCredentials = url.username !== '' || url.password !== '';
  if (url.origin !== ANTHROPIC_API_URL || hasCredentials || url.pathname !== MESSAGES_PATH || url.hash !== '') return undefined;
  return url.search === '' || url.search === BETA_QUERY ? url.search : undefined;
}

/**
 * Puerta de salida del cliente de Claude: el `fetch` que recibe el SDK, el último código antes de la red.
 *
 * El SDK mezcla en cada petición cabeceras del entorno (`ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_AUTH_TOKEN`) que
 * pueden sustituir la clave de Franca o añadir otra credencial (ficha `gotcha-sdk-anthropic-lee-el-entorno`). Esta
 * puerta no depende de qué lea el SDK: deniega por defecto y reconstruye la petición desde cero.
 * - Solo `POST https://api.anthropic.com/v1/messages`, con consulta vacía o `?beta=true`; si no, lanza un `Error` de
 *   texto fijo sin valores (el SDK lo trata como fallo de conexión y el adaptador resuelve `failed`).
 * - Cabeceras: `accept`, `content-type`, `anthropic-version` y `x-api-key` fijas y, solo en `?beta=true`, el
 *   `anthropic-beta` que puso el adaptador. Nunca `authorization`, `cookie`, `x-stainless-*` ni nada más.
 * - Pasa `method`, `body` y `signal`; descarta el resto de `init`.
 *
 * @param apiKey Clave de `FRANCA_ANTHROPIC_API_KEY`.
 * @param send Salida real (`fetch`) o, en un test, una que registra y no envía.
 * @returns El `fetch` del cliente.
 */
export function createAnthropicEgress(apiKey: string, send: Send): Send {
  return async (input, init) => {
    const search = allowedSearch(input);
    if (search === undefined || init === undefined || init === null || init.method !== 'POST') throw new Error(DENIED);
    const received = new Headers(init.headers);
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      'x-api-key': apiKey,
    };
    const beta = search === BETA_QUERY ? received.get('anthropic-beta') : null;
    if (beta !== null) headers['anthropic-beta'] = beta;
    return send(`${ANTHROPIC_API_URL}${MESSAGES_PATH}${search}`, { method: 'POST', headers, body: init.body, signal: init.signal });
  };
}

/**
 * Cliente de Claude de la API: clave y `baseURL` explícitas, sin `authToken` y con la puerta de salida. Construirlo no
 * abre conexiones.
 *
 * @param apiKey Clave de `FRANCA_ANTHROPIC_API_KEY`.
 * @param send Salida a la red; solo la inyecta un test.
 * @returns El cliente del SDK.
 */
export function createPrincipalClient(apiKey: string, send: Send = globalThis.fetch): ReturnType<typeof createAnthropicClient> {
  return createAnthropicClient({ apiKey, authToken: null, baseURL: ANTHROPIC_API_URL, fetch: createAnthropicEgress(apiKey, send) });
}

/**
 * Proveedores `llm` de la instalación: vacío sin clave (los nodos `llm` fallan con `llm_not_configured`) o
 * `principal`, Claude con las opciones por defecto del adaptador.
 *
 * @param config Configuración de las conversaciones.
 * @returns Nombre de proveedor → capacidad.
 */
export function createLlmProviders(config: Pick<ConversationsConfig, 'anthropicApiKey'>): Map<string, LlmCapability> {
  const providers = new Map<string, LlmCapability>();
  if (config.anthropicApiKey !== null) providers.set('principal', createAnthropicProvider({ client: createPrincipalClient(config.anthropicApiKey) }));
  return providers;
}
