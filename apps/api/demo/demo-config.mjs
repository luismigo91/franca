// @ts-check
// Configuración de la demo local (C3 de dev-servicios-simulados): lo que fija el arranque para la API y quién la pisaría.
import { randomBytes } from 'node:crypto';

/** El CRM simulado solo escucha en loopback. */
export const CRM_HOST = '127.0.0.1';
/** Puerto fijo del CRM simulado: no hay variable para cambiarlo. */
export const CRM_PORT = 4010;
/** Nombre local con el que el flujo llama al CRM. */
export const CRM_NAME = 'crm.franca.test';
/** Id del flujo que siembra la demo. */
export const DEMO_FLOW_ID = 'captacion-leads-local';
/** Nombre visible del flujo que hay que probar en el chat. */
export const DEMO_FLOW_NAME = 'Captación de leads (local)';
/** Dirección de la web. */
export const WEB_URL = 'http://localhost:3000';

/** Las variables que la demo fija ella misma, en este orden: es también la lista de conflictos con la shell. */
export const DEMO_VARIABLE_NAMES = Object.freeze([
  'FRANCA_HTTP_LOCAL_NAMES',
  'FRANCA_HTTP_ALLOWED_DESTINATIONS',
  'FRANCA_HTTP_SECRET_ORIGINS',
  'FRANCA_SECRET_CRM_TOKEN',
]);

/** La clave de Claude: la demo arranca la API sin ella. */
export const ANTHROPIC_KEY_VARIABLE = 'FRANCA_ANTHROPIC_API_KEY';

/**
 * Crea el token de la ejecución: `Bearer ` más 256 bits aleatorios en base64url (43 caracteres).
 *
 * @returns {string} El valor completo de la cabecera `Authorization`.
 */
export function createRunToken() {
  return `Bearer ${randomBytes(32).toString('base64url')}`;
}

/**
 * Las cuatro variables de la salida http que fija la demo.
 *
 * @param {object} options Opciones.
 * @param {string} options.token El token de la ejecución (valor completo de la cabecera).
 * @param {number} [options.crmPort] Puerto del CRM simulado.
 * @returns {Record<string, string>} Variable → valor.
 */
export function demoHttpVariables({ token, crmPort = CRM_PORT }) {
  return {
    FRANCA_HTTP_LOCAL_NAMES: `${CRM_NAME}=${CRM_HOST}`,
    FRANCA_HTTP_ALLOWED_DESTINATIONS: `${CRM_HOST}:${crmPort}`,
    FRANCA_HTTP_SECRET_ORIGINS: `CRM_TOKEN=http://${CRM_NAME}:${crmPort}`,
    FRANCA_SECRET_CRM_TOKEN: token,
  };
}

/**
 * Los nombres de `DEMO_VARIABLE_NAMES` que la shell ya define, aunque sea con `""`.
 *
 * @param {Record<string, string | undefined>} env El entorno de la shell.
 * @returns {string[]} Los nombres en conflicto, en el orden de `DEMO_VARIABLE_NAMES`. Nunca sus valores.
 */
export function findConflicts(env) {
  return DEMO_VARIABLE_NAMES.filter((name) => Object.hasOwn(env, name));
}

/**
 * El entorno con el que arranca `pnpm dev`: el de la shell sin la clave de Claude, con las cuatro variables de la salida
 * http, y la telemetría de Next y de turbo desactivada. No modifica `env`.
 *
 * @param {Record<string, string | undefined>} env El entorno de la shell.
 * @param {string} token El token de la ejecución.
 * @returns {Record<string, string | undefined>} Un objeto nuevo.
 */
export function buildApiEnvironment(env, token) {
  const built = { ...env };
  delete built[ANTHROPIC_KEY_VARIABLE];
  return {
    ...built,
    ...demoHttpVariables({ token }),
    NEXT_TELEMETRY_DISABLED: '1',
    TURBO_TELEMETRY_DISABLED: '1',
  };
}
