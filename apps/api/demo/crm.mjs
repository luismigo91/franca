// @ts-check
// CRM simulado de la demo local (C2 de dev-servicios-simulados): acepta leads en loopback y no guarda nada.
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { CRM_HOST, CRM_PORT } from './demo-config.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOGGED_PATH = 200;
const MAX_LOGGED_METHOD = 16;

/**
 * Una cadena para el registro: solo ASCII visible (lo demás se escribe como `?`) y cortada a `limit` caracteres.
 *
 * @param {string} text El texto de la petición.
 * @param {number} limit Longitud máxima.
 * @returns {string} El texto saneado.
 */
function printable(text, limit) {
  return text.slice(0, limit).replace(/[^\x21-\x7e]/g, '?');
}

/**
 * Indica si la cabecera `Authorization` es exactamente el token.
 *
 * @param {string | undefined} header Valor de la cabecera.
 * @param {string} token El token de la ejecución.
 * @returns {boolean} `true` si coincide (longitud y luego comparación en tiempo constante).
 */
function isAuthorized(header, token) {
  if (header === undefined) return false;
  const given = Buffer.from(header, 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Indica si el tipo de medio de `Content-Type` es `application/json` (sin parámetros, mayúsculas ni espacios).
 *
 * @param {string | undefined} header Valor de la cabecera.
 * @returns {boolean} `true` si lo es.
 */
function isJsonMediaType(header) {
  if (header === undefined) return false;
  return (header.split(';')[0] ?? '').trim().toLowerCase() === 'application/json';
}

/**
 * Indica si los bytes son UTF-8 y un objeto JSON (ni `null` ni un array).
 *
 * @param {Buffer} bytes El cuerpo entero.
 * @returns {boolean} `true` si lo es.
 */
function isJsonObject(bytes) {
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * El manejador del CRM simulado. Comprobaciones por orden, y se responde con la primera que falla: ruta y método (404),
 * `Authorization` (401), `Content-Type` (400 `unsupported_media_type`) y cuerpo (400 `invalid_body`). Un 201 asigna `L-<n>`.
 * Los errores no repiten nada de la petición, y el contador solo sube en un 201.
 *
 * @param {object} options Opciones.
 * @param {string} options.token El token de la ejecución (valor completo de la cabecera `Authorization`).
 * @param {(line: string) => void} options.log Recibe una línea por petición: método, ruta sin consulta, status e id. Nunca cabeceras, consulta ni cuerpo.
 * @returns {import('node:http').RequestListener} El manejador de `node:http`.
 */
export function createCrmHandler({ token, log }) {
  let assigned = 0;
  return (req, res) => {
    const method = req.method ?? '';
    const path = (req.url ?? '').split('?')[0] ?? '';

    /**
     * @param {number} status Código HTTP.
     * @param {unknown} body Cuerpo JSON.
     * @param {string} [id] El id asignado, si es un 201.
     */
    const respond = (status, body, id) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), Connection: 'close' });
      res.end(text);
      log(`[crm simulado] ${printable(method, MAX_LOGGED_METHOD)} ${printable(path, MAX_LOGGED_PATH)} ${status}${id === undefined ? '' : ` ${id}`}`);
    };
    /**
     * Rechaza sin interpretar el cuerpo: se drena antes de responder para que el cliente no reciba un `ECONNRESET` mientras envía.
     *
     * @param {number} status Código HTTP.
     * @param {string} reason Motivo estable.
     */
    const reject = (status, reason) => {
      req.resume();
      respond(status, { error: reason });
    };

    if (method !== 'POST' || path !== '/api/leads') return reject(404, 'not_found');
    if (!isAuthorized(req.headers.authorization, token)) return reject(401, 'unauthorized');
    if (!isJsonMediaType(req.headers['content-type'])) return reject(400, 'unsupported_media_type');

    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('error', () => undefined);
    req.on('end', () => {
      if (tooLarge || !isJsonObject(Buffer.concat(chunks))) return respond(400, { error: 'invalid_body' });
      assigned += 1;
      const id = `L-${assigned}`;
      respond(201, { id }, id);
    });
  };
}

/**
 * Arranca el CRM simulado en `127.0.0.1:<port>`.
 *
 * @param {object} options Opciones.
 * @param {string} options.token El token de la ejecución.
 * @param {number} [options.port] Puerto; `0` elige uno libre.
 * @param {(line: string) => void} options.log Recibe las líneas de registro.
 * @returns {Promise<{ port: number, close: () => Promise<void> }>} El puerto real y el cierre.
 * @throws {string} El `code` del sistema (`EADDRINUSE`…) si no puede escuchar.
 */
export function startCrm({ token, port = CRM_PORT, log }) {
  return new Promise((resolve, reject) => {
    const server = createServer(createCrmHandler({ token, log }));
    server.once('error', (/** @type {NodeJS.ErrnoException} */ error) => reject(error.code ?? 'ERROR'));
    server.listen(port, CRM_HOST, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address !== null ? address.port : port;
      log(`[crm simulado] escuchando en ${CRM_HOST}:${actual}`);
      resolve({
        port: actual,
        close: () =>
          new Promise((done) => {
            server.close(() => done(undefined));
            server.closeAllConnections();
          }),
      });
    });
  });
}

/** Escribe una línea en la salida estándar. */
const writeLine = (/** @type {string} */ line) => void process.stdout.write(`${line}\n`);

/**
 * El CRM como proceso hijo (`fork`): recibe `{type: 'start', token, port}` por IPC y responde `listening` o `failed`; termina
 * con `{type: 'stop'}`, `SIGTERM` o al perder el canal, e ignora `SIGINT`. El token solo viaja por el canal IPC.
 */
function runAsProcess() {
  if (typeof process.send !== 'function') {
    process.stderr.write('El CRM simulado se arranca con pnpm dev:demo.\n');
    process.exit(2);
  }
  // Con la terminal cerrada, escribir da EIO: sin manejador tumbaría el proceso a mitad de la parada.
  process.stdout.on('error', () => undefined);
  process.stderr.on('error', () => undefined);
  const send = process.send.bind(process);
  /** @type {{ close: () => Promise<void> } | undefined} */
  let running;
  const shutdown = () => {
    void (running ? running.close() : Promise.resolve()).finally(() => process.exit(0));
  };
  process.on('SIGINT', () => undefined);
  process.on('SIGTERM', shutdown);
  process.on('disconnect', shutdown);
  process.on('message', (/** @type {{ type?: string, token?: string, port?: number }} */ message) => {
    if (message?.type === 'stop') return shutdown();
    if (message?.type !== 'start' || typeof message.token !== 'string') return;
    startCrm({ token: message.token, port: message.port, log: writeLine }).then(
      (crm) => {
        running = crm;
        send({ type: 'listening', port: crm.port });
      },
      (code) => send({ type: 'failed', code: String(code) }, () => process.exit(1)),
    );
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) runAsProcess();
