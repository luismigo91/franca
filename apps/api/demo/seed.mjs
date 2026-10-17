// @ts-check
// Semilla de la demo local (C5, D11, D12 de dev-servicios-simulados): deja `captacion-leads-local` publicada en la API local.
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ApiUrlError, parseApiUrl } from '../../web/src/server/config/api-url.mjs';
import { DEMO_FLOW_ID } from './demo-config.mjs';

/** @typedef {import('../../web/src/server/config/api-url.mjs').ApiTarget} ApiTarget */

/**
 * @typedef {object} ApiRequest
 * @property {ApiTarget} target Destino ya validado.
 * @property {'GET' | 'POST'} method Método.
 * @property {string} path Ruta.
 * @property {Record<string, string>} [headers] Cabeceras de la petición.
 * @property {string} [body] Cuerpo de texto.
 * @property {AbortSignal} [signal] Plazo de toda la semilla.
 */

/**
 * @typedef {object} ApiResponse
 * @property {number} status Código HTTP.
 * @property {Record<string, string | string[] | undefined>} headers Cabeceras de la respuesta (en minúsculas).
 * @property {string} body Cuerpo, cortado a 4 MiB.
 */

/** @typedef {(request: ApiRequest) => Promise<ApiResponse>} RequestApi */

/** Plazo de cada petición. */
const REQUEST_TIMEOUT_MS = 5_000;
/** Plazo de la semilla entera. */
export const SEED_TIMEOUT_MS = 12_000;
/** La respuesta se corta aquí. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const ERROR_CODE = /^[a-z_]{1,64}$/;

/** Fallo de transporte: la API no se alcanzó (`unreachable`) o no respondió a tiempo (`timeout`). */
export class ApiRequestError extends Error {
  /** @param {'unreachable' | 'timeout'} kind El motivo. */
  constructor(kind) {
    super(kind);
    this.name = 'ApiRequestError';
    this.kind = kind;
  }
}

/**
 * Una petición a una dirección concreta. No usa `http.globalAgent` (`agent: false`: `NODE_USE_ENV_PROXY` no interviene) ni
 * lleva `Origin` (la API respondería 403 `forbidden_origin`).
 *
 * @param {ApiRequest} request La petición.
 * @param {string} address Dirección IP a la que conecta el socket, sin DNS.
 * @returns {Promise<ApiResponse>} La respuesta.
 * @throws {ApiRequestError} Si no se alcanza o se agota el plazo.
 */
function requestOnce({ target, method, path, headers, body, signal }, address) {
  return new Promise((resolve, reject) => {
    const limit = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal === undefined ? limit : AbortSignal.any([limit, signal]);
    const bytes = body === undefined ? undefined : Buffer.from(body, 'utf8');
    const req = httpRequest(
      {
        agent: false,
        host: address,
        port: target.port,
        method,
        path,
        signal: combined,
        headers: { Host: target.hostHeader, ...(bytes === undefined ? {} : { 'Content-Length': String(bytes.length) }), ...headers },
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let size = 0;
        res.on('data', (/** @type {Buffer} */ chunk) => {
          if (size >= MAX_RESPONSE_BYTES) return;
          size += chunk.length;
          chunks.push(chunk);
          if (size > MAX_RESPONSE_BYTES) res.destroy();
        });
        const finish = () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString('utf8') });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', () => reject(new ApiRequestError('unreachable')));
      },
    );
    req.on('error', (error) => reject(new ApiRequestError(error.name === 'AbortError' || combined.aborted ? 'timeout' : 'unreachable')));
    req.end(bytes);
  });
}

/**
 * Una petición a la API de Franca. Con `localhost` intenta `127.0.0.1` y, si se rechaza la conexión, `::1`.
 *
 * @type {RequestApi}
 * @throws {ApiRequestError} Si no se alcanza o se agota el plazo.
 */
export async function requestApi(request) {
  const addresses = request.target.family === 'loopback' ? ['127.0.0.1', '::1'] : [request.target.address];
  /** @type {ApiRequestError} */
  let last = new ApiRequestError('unreachable');
  for (const address of addresses) {
    try {
      return await requestOnce(request, address);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.kind === 'timeout') throw error;
      last = error;
    }
  }
  throw last;
}

/** La copia de la demo, tal como está en disco. */
const DEMO_COPY = JSON.parse(readFileSync(new URL('./captacion-leads-local.json', import.meta.url), 'utf8'));

/**
 * @param {string} text Cuerpo de la respuesta.
 * @returns {unknown} El JSON, o `undefined` si no lo es.
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * El campo `error` del cuerpo, solo si cumple `^[a-z_]{1,64}$`: un cuerpo inesperado no puede meter texto en la salida.
 *
 * @param {ApiResponse} response La respuesta.
 * @returns {string | undefined} El código, o `undefined`.
 */
function errorCodeOf(response) {
  const body = parseJson(response.body);
  const code = typeof body === 'object' && body !== null ? /** @type {{ error?: unknown }} */ (body).error : undefined;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : undefined;
}

/** La semilla termina en el mensaje: no es un error de programa. */
class SeedStop extends Error {}

/**
 * Siembra `captacion-leads-local`, sin lista de flujos (hoy hay una sola copia). Algoritmo de C5: lee el flujo; si no existe lo
 * crea; si su borrador no es la copia como JSON no lo toca; si lo es, publica con `If-Match`. Idempotente: publicar sin cambios
 * devuelve 200 con la última versión y no cambia la `revision`.
 *
 * @param {object} options Opciones.
 * @param {Record<string, string | undefined>} options.env Entorno (se lee `FRANCA_API_URL`).
 * @param {(line: string) => void} options.write Recibe cada línea de resultado, ya con el prefijo `[semilla] `.
 * @param {RequestApi} [options.request] Transporte; por defecto `requestApi`.
 * @param {unknown} [options.copy] El flujo que se siembra; por defecto la copia de la demo.
 * @returns {Promise<{ ok: boolean }>} `ok` es `true` solo si el flujo queda publicado con el contenido de la copia.
 */
export async function seedDemo({ env, write, request = requestApi, copy = DEMO_COPY }) {
  /** @param {string} text */
  const say = (text) => write(`[semilla] ${text}`);
  const label = `${DEMO_FLOW_ID}:`;
  /** @type {ApiTarget} */
  let target;
  try {
    target = parseApiUrl(env.FRANCA_API_URL);
  } catch (error) {
    say(error instanceof ApiUrlError ? error.message : 'FRANCA_API_URL no es válida.');
    return { ok: false };
  }
  const signal = AbortSignal.timeout(SEED_TIMEOUT_MS);
  const flowPath = `/flows/${DEMO_FLOW_ID}`;

  /**
   * @param {ApiRequest['method']} method
   * @param {string} path
   * @param {{ headers?: Record<string, string>, body?: string }} [extra]
   */
  const call = (method, path, extra = {}) => request({ target, method, path, signal, ...extra });
  /** @param {ApiResponse} response */
  const unexpected = (response) => {
    const code = errorCodeOf(response);
    return new SeedStop(`${label} respuesta inesperada de la API (HTTP ${response.status}${code === undefined ? '' : `, ${code}`}).`);
  };
  /** @param {ApiResponse} response */
  const checkCommon = (response) => {
    if (response.status === 503 && errorCodeOf(response) === 'database_unavailable') {
      throw new SeedStop('La base de datos no responde: arráncala con docker compose up -d y repite pnpm demo:seed.');
    }
  };
  /** @param {ApiResponse} response */
  const etagOf = (response) => {
    const etag = response.headers.etag;
    if (typeof etag !== 'string') throw unexpected(response);
    return etag;
  };

  try {
    let created = false;
    let retried = false;
    let firstRead = true;
    /** @type {string} */
    let etag;
    for (;;) {
      const read = await call('GET', flowPath);
      checkCommon(read);
      if (read.status === 200) {
        const body = /** @type {{ flow?: unknown } | undefined} */ (parseJson(read.body));
        if (!isDeepStrictEqual(body?.flow, copy)) {
          throw new SeedStop(
            `${label} su borrador no es la copia de la demo y no se ha tocado. Para volver a la copia, sustituye el borrador por apps/api/demo/captacion-leads-local.json.`,
          );
        }
        etag = etagOf(read);
        break;
      }
      if (read.status === 500 && firstRead) {
        throw new SeedStop(
          `${label} la API ha respondido 500 al leerlo. Si la base de datos es nueva, aplica las migraciones con pnpm --filter @franca/api db:migrate y repite pnpm demo:seed.`,
        );
      }
      if (read.status !== 404 || errorCodeOf(read) !== 'flow_not_found') throw unexpected(read);
      firstRead = false;

      const create = await call('POST', '/flows', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(copy) });
      checkCommon(create);
      if (create.status === 201) {
        created = true;
        etag = etagOf(create);
        break;
      }
      const code = errorCodeOf(create);
      if (create.status === 409 && code === 'flow_id_reserved') {
        throw new SeedStop(
          `${label} el id ${DEMO_FLOW_ID} está reservado por un borrado y la API no deja reutilizarlo. Solo se recupera borrando la base de datos local (docker compose down -v), que borra todos los flujos y conversaciones.`,
        );
      }
      if (create.status === 409 && code === 'flow_already_exists' && !retried) {
        retried = true;
        continue;
      }
      throw unexpected(create);
    }

    const publish = await call('POST', `${flowPath}/versions`, { headers: { 'If-Match': etag } });
    checkCommon(publish);
    if (publish.status === 412 && errorCodeOf(publish) === 'revision_mismatch') {
      throw new SeedStop(`${label} el borrador ha cambiado mientras se sembraba y no se ha publicado. Repite pnpm demo:seed.`);
    }
    if (publish.status !== 200 && publish.status !== 201) throw unexpected(publish);
    const version = /** @type {{ flow?: unknown, version?: unknown } | undefined} */ (parseJson(publish.body));
    if (!isDeepStrictEqual(version?.flow, copy) || typeof version?.version !== 'number') throw unexpected(publish);
    if (publish.status === 200) say(`${label} ya estaba publicado (versión ${version.version}).`);
    else say(created ? `${label} creado y publicado (versión ${version.version}).` : `${label} publicado (versión ${version.version}).`);
    return { ok: true };
  } catch (error) {
    if (error instanceof SeedStop) {
      say(error.message);
      return { ok: false };
    }
    if (error instanceof ApiRequestError) {
      say(
        error.kind === 'timeout'
          ? `La API de Franca en http://${target.hostHeader} no ha respondido a tiempo.`
          : `No puedo conectar con la API de Franca en http://${target.hostHeader}. ¿Está arrancada (pnpm dev o pnpm dev:demo)?`,
      );
      return { ok: false };
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ok } = await seedDemo({ env: process.env, write: (line) => void process.stdout.write(`${line}\n`) });
  process.exitCode = ok ? 0 : 1;
}
