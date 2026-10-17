// @ts-check

/** Dirección de la API si `FRANCA_API_URL` no está definida. */
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/**
 * @typedef {object} ApiTarget
 * @property {string} hostHeader Valor de la cabecera `Host` hacia la API (`127.0.0.1:3001`).
 * @property {string} address Dirección o nombre al que conecta el socket (`127.0.0.1`, `::1` o `localhost`).
 * @property {4 | 6 | 'loopback'} family Familia: `loopback` es `localhost` (IPv4 e IPv6 de loopback, sin DNS).
 * @property {number} port Puerto TCP.
 */

/** Error de configuración: su mensaje nombra la variable y nunca repite el valor. */
export class ApiUrlError extends Error {
  constructor() {
    super(
      'FRANCA_API_URL no es válida: solo se admite http:// hacia 127.0.0.1, [::1] o localhost, ' +
        'con puerto opcional y sin ruta, consulta, usuario ni contraseña.',
    );
    this.name = 'ApiUrlError';
  }
}

const LOOPBACK = {
  '127.0.0.1': /** @type {const} */ ({ address: '127.0.0.1', family: 4 }),
  '[::1]': /** @type {const} */ ({ address: '::1', family: 6 }),
  localhost: /** @type {const} */ ({ address: 'localhost', family: 'loopback' }),
};

/**
 * Valida `FRANCA_API_URL` y la reduce a lo que necesita el transporte. Se decide sobre la URL **parseada**, tras
 * rechazar antes cualquier carácter fuera de ASCII visible (`new URL` quita tabuladores y saltos de línea en silencio).
 *
 * @param {string | undefined} raw Valor de la variable; `undefined` si no está definida (un texto vacío no es «sin variable»).
 * @returns {ApiTarget} El destino.
 * @throws {ApiUrlError} Si el valor no es admitido.
 */
export function parseApiUrl(raw) {
  const value = raw === undefined ? DEFAULT_API_URL : raw;
  // `?`, `#`, `@` y `\` no caben: un `?` o `#` vacío no deja rastro en `search` ni `hash`, y `\` es `/` para WHATWG.
  if (!/^[\x21-\x7e]+$/.test(value) || /[?#@\\]/.test(value)) throw new ApiUrlError();
  if (!URL.canParse(value)) throw new ApiUrlError();
  const url = new URL(value);
  const target = Object.prototype.hasOwnProperty.call(LOOPBACK, url.hostname) ? LOOPBACK[/** @type {keyof typeof LOOPBACK} */ (url.hostname)] : undefined;
  if (url.protocol !== 'http:' || target === undefined) throw new ApiUrlError();
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') throw new ApiUrlError();
  const port = url.port === '' ? 80 : Number(url.port);
  if (port === 0) throw new ApiUrlError();
  return { hostHeader: url.host, address: target.address, family: target.family, port };
}
