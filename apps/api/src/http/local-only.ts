import type { NextFunction, Request, Response } from 'express';
import { ApiException } from './api-error.js';

const LOCAL_NAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const PORT = /^:[0-9]{1,5}$/;

/**
 * Indica si una cabecera `Host` nombra la máquina local: `localhost`, `127.0.0.1` o `[::1]`, con puerto opcional y
 * sin distinguir mayúsculas. Comparación exacta del nombre: `localhost.evil.example`, `localhost.` o
 * `127.0.0.1.nip.io` no valen (un dominio que resuelva a la máquina local con DNS rebinding no debe poder usar la API).
 *
 * @param host Valor de la cabecera `Host`; `undefined` si falta.
 * @returns `true` si es un nombre local.
 */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const value = host.toLowerCase();
  const end = value.startsWith('[') ? value.indexOf(']') + 1 : value.indexOf(':');
  const name = end <= 0 ? value : value.slice(0, end);
  const rest = end <= 0 ? '' : value.slice(end);
  return LOCAL_NAMES.has(name) && (rest === '' || PORT.test(rest));
}

/**
 * Middleware de la frontera de la API: sin autenticación en v0, solo atiende a la máquina local. Primero el
 * `Host` (403 `forbidden_host`) y después cualquier `Origin` (403 `forbidden_origin`), también `null` o vacío.
 * Va antes de leer el cuerpo y de todo lo demás.
 */
export function localOnly(request: Request, _response: Response, next: NextFunction): void {
  if (!isLocalHost(request.headers.host)) return next(new ApiException('forbidden_host'));
  if (request.headers.origin !== undefined) return next(new ApiException('forbidden_origin'));
  next();
}
