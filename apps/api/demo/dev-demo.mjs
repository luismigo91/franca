// @ts-check
// Arranque de la demo local (C4, D5-D9, D13 de dev-servicios-simulados): `pnpm dev:demo`.
// Lanza el CRM simulado y lo mismo que `pnpm dev`, siembra la copia local y lo para todo con una sola señal.
import { fork, spawn } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseApiUrl } from '../../web/src/server/config/api-url.mjs';
import {
  ANTHROPIC_KEY_VARIABLE,
  buildApiEnvironment,
  createRunToken,
  CRM_HOST,
  CRM_NAME,
  CRM_PORT,
  DEMO_FLOW_NAME,
  findConflicts,
  WEB_URL,
} from './demo-config.mjs';
import { ApiRequestError, requestApi, seedDemo } from './seed.mjs';

/** Espera del `listening` del CRM. */
export const CRM_START_TIMEOUT_MS = 5_000;
/** Margen para que los procesos salgan tras la señal; vencido, `SIGKILL`. */
export const STOP_GRACE_MS = 7_000;
/** Plazo absoluto desde la primera causa de parada: vencido, `SIGKILL` y `process.exit` sin esperar a nada. */
export const STOP_DEADLINE_MS = 9_500;
/** Comprobación de puertos tras parar. */
export const PORT_CHECK_MS = 2_000;
/** Espera a que la API responda. */
export const API_WAIT_MS = 120_000;
/** Intervalo entre sondeos de la API. */
export const API_POLL_MS = 500;

/** Código de salida por señal. */
const SIGNAL_CODES = /** @type {const} */ ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 });
/** Las señales que paran la demo. */
export const STOP_SIGNALS = /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP']);
/** @typedef {keyof typeof SIGNAL_CODES} StopSignal */

/**
 * @typedef {object} CrmProcess
 * @property {(token: string, port: number) => Promise<{ ok: true } | { ok: false, code: string }>} start Pide escuchar y espera la respuesta (5 s).
 * @property {() => void} stop Pide parar (`{type: 'stop'}`).
 * @property {() => void} kill `SIGKILL`.
 * @property {Promise<number | null>} exited Se resuelve con su código al terminar.
 */

/**
 * @typedef {object} TurboProcess
 * @property {(signal: NodeJS.Signals) => void} signalGroup Envía la señal al grupo de procesos de turbo.
 * @property {Promise<{ code: number | null, signal: string | null }>} exited Se resuelve al terminar.
 */

/**
 * @typedef {object} DemoDeps
 * @property {Record<string, string | undefined>} env Entorno de la shell.
 * @property {(line: string) => void} write Escribe una línea de salida.
 * @property {() => string} createToken Crea el token de la ejecución.
 * @property {() => CrmProcess} launchCrm Lanza el proceso del CRM.
 * @property {(env: Record<string, string | undefined>) => TurboProcess} launchTurbo Lanza `turbo run dev` en un grupo propio.
 * @property {() => Promise<boolean>} probeApi `true` si la API responde cualquier cosa (2 s por intento).
 * @property {(write: (line: string) => void) => Promise<{ ok: boolean }>} seed Siembra la copia.
 * @property {(ports: number[], timeoutMs: number) => Promise<{ host: string, port: number }[]>} checkPorts Durante `timeoutMs` como mucho, qué acepta conexiones aún.
 * @property {(handler: (signal: StopSignal) => void) => () => void} onSignals Se suscribe a las señales de parada; devuelve cómo dejar de escuchar.
 * @property {(code: number) => void} exit Termina el proceso (el plazo absoluto lo usa sin esperar a nada).
 */

/**
 * El puerto de la API que se comprueba al parar: `PORT` si es un puerto válido, o 3001.
 *
 * @param {Record<string, string | undefined>} env Entorno.
 * @returns {number} El puerto.
 */
function apiPortOf(env) {
  const port = Number(env.PORT);
  return env.PORT !== undefined && Number.isInteger(port) && port > 0 && port < 65536 ? port : 3001;
}

/**
 * Espera `ms` o hasta que `signal` aborte.
 *
 * @param {number} ms Milisegundos.
 * @param {AbortSignal} signal Cancelación.
 * @returns {Promise<void>} Se resuelve en cualquiera de los dos casos.
 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Sondea la API cada 500 ms hasta que responda algo, pasen 120 s o se cancele.
 *
 * @param {() => Promise<boolean>} probe Un sondeo.
 * @param {AbortSignal} signal Cancelación (una parada en curso corta la espera).
 * @returns {Promise<'ready' | 'timeout' | 'aborted'>} El resultado.
 */
async function waitForApi(probe, signal) {
  let expired = false;
  const timer = setTimeout(() => (expired = true), API_WAIT_MS);
  try {
    while (!signal.aborted) {
      if (await probe()) return 'ready';
      if (expired) return 'timeout';
      await sleep(API_POLL_MS, signal);
      if (expired) return 'timeout';
    }
    return 'aborted';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ejecuta la demo: conflictos → token → aviso de Claude → CRM → turbo → espera de la API → semilla → «Lista». Todas las causas
 * de parada siguen el mismo camino (`stopAll`), que termina siempre: la primera causa arranca un plazo absoluto de 9,5 s.
 *
 * @param {DemoDeps} deps Las piezas (los procesos reales en `main`; dobles en los tests).
 * @returns {Promise<number>} El código de salida.
 */
export async function runDemo(deps) {
  /** @param {string} text */
  const say = (text) => {
    try {
      deps.write(`[demo] ${text}`);
    } catch {
      // Con la terminal cerrada escribir falla: la parada no puede depender de ello.
    }
  };

  const conflicts = findConflicts(deps.env);
  if (conflicts.length > 0) {
    say(`La demo no arranca: la shell ya define ${conflicts.join(', ')}. La demo fija esas variables ella misma: quítalas con unset o usa pnpm dev.`);
    return 1;
  }

  const token = deps.createToken();
  say(
    `La demo no usa Claude: la API arranca sin ${ANTHROPIC_KEY_VARIABLE} y los nodos llm terminan en llm_not_configured.${
      Object.hasOwn(deps.env, ANTHROPIC_KEY_VARIABLE) ? ' (se ha quitado la de la shell)' : ''
    }`,
  );

  /** @type {(code: number) => void} */
  let finish = () => undefined;
  const done = new Promise((/** @type {(code: number) => void} */ resolve) => (finish = resolve));
  const cancel = new AbortController();
  let stopping = false;
  let exitCode = 0;
  let crmExited = false;
  let turboExited = false;
  /** @type {TurboProcess | undefined} */
  let turbo;

  const crm = deps.launchCrm();
  void crm.exited.then((code) => {
    crmExited = true;
    if (!stopping) void stopAll(1, `El CRM simulado se ha parado (código ${code ?? 'señal'}); paro la API y la web.`);
  });

  /** @param {NodeJS.Signals} signal */
  const signalTurbo = (signal) => {
    try {
      turbo?.signalGroup(signal);
    } catch {
      // El grupo ya no existe.
    }
  };
  const killAll = () => {
    signalTurbo('SIGKILL');
    try {
      crm.kill();
    } catch {
      // Ya terminó.
    }
  };

  /**
   * Para todo lo que arrancó. Una parada en curso ignora cualquier causa nueva; el código es el de la primera.
   *
   * @param {number} code Código de salida de la primera causa.
   * @param {string} message Lo que se escribe al empezar.
   */
  async function stopAll(code, message) {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    say(message);
    // Plazo absoluto (H1): vencido, SIGKILL y salir sin esperar a ningún `exit`.
    const deadline = setTimeout(() => {
      killAll();
      deps.exit(exitCode);
    }, STOP_DEADLINE_MS);
    deadline.unref?.();
    // No espera a la semilla ni al sondeo de la API: los cancela.
    cancel.abort();
    if (turbo !== undefined && !turboExited) signalTurbo('SIGINT');
    if (!crmExited) {
      try {
        crm.stop();
      } catch {
        // El canal ya se cerró.
      }
    }
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let graceTimer;
    const grace = new Promise((resolve) => (graceTimer = setTimeout(() => resolve('late'), STOP_GRACE_MS)));
    const exits = Promise.all([crm.exited, turbo?.exited]).then(() => 'exited');
    const outcome = await Promise.race([exits, grace]);
    clearTimeout(graceTimer);
    if (outcome === 'late') killAll();

    const ports = [3000, apiPortOf(deps.env), CRM_PORT];
    const busy = await deps.checkPorts(ports, PORT_CHECK_MS);
    for (const { host, port } of busy) {
      say(`Atención: algo sigue escuchando en ${host.includes(':') ? `[${host}]` : host}:${port}; búscalo con lsof -nP -iTCP:${port} -sTCP:LISTEN.`);
    }
    if (busy.length > 0) exitCode = 1;
    clearTimeout(deadline);
    say('Parada.');
    finish(exitCode);
  }

  const dispose = deps.onSignals((signal) => {
    void stopAll(SIGNAL_CODES[signal], 'Parando…');
  });

  /** Arranque: CRM → turbo → API → semilla. Una parada en curso lo corta en cualquier punto. */
  const startup = async () => {
    const started = await crm.start(token, CRM_PORT);
    if (stopping) return;
    if (!started.ok) {
      say(`La demo no arranca: el CRM simulado no puede escuchar en ${CRM_HOST}:${CRM_PORT} (${started.code === 'EADDRINUSE' ? 'puerto 4010 ocupado' : started.code}).`);
      try {
        crm.kill();
      } catch {
        // Ya terminó.
      }
      stopping = true;
      finish(1);
      return;
    }
    say(`CRM simulado en http://${CRM_HOST}:${CRM_PORT} (${CRM_NAME}). Arrancando la API y la web (pnpm dev)…`);

    // H2: una señal que llegó esperando al CRM ya puso `stopping`; turbo no se lanza.
    if (stopping) return;
    turbo = deps.launchTurbo(buildApiEnvironment(deps.env, token));
    void turbo.exited.then(({ code, signal }) => {
      turboExited = true;
      if (stopping) return;
      const exit = code !== null && code !== 0 ? code : 1;
      void stopAll(exit, `pnpm dev ha terminado (código ${code ?? signal}); paro el CRM simulado.`);
    });

    const api = await waitForApi(deps.probeApi, cancel.signal);
    if (stopping || api === 'aborted') return;
    if (api === 'timeout') {
      say(`La API no ha respondido en ${API_WAIT_MS / 1000} s; la demo sigue en marcha. Cuando arranque, siembra con pnpm demo:seed.`);
      return;
    }
    say('La API responde; sembrando la copia local…');
    const seeded = await deps.seed((line) => {
      if (!stopping) deps.write(line);
    });
    if (stopping) return;
    say(
      seeded.ok
        ? `Lista: abre ${WEB_URL} y prueba «${DEMO_FLOW_NAME}». Ctrl+C para parar.`
        : 'La semilla no ha terminado bien (motivo arriba); la demo sigue en marcha. Puedes repetirla con pnpm demo:seed.',
    );
  };
  void startup().catch((error) => {
    say(`La demo no arranca: ${error instanceof Error ? error.message : 'error inesperado'}.`);
    void stopAll(1, 'Parando…');
  });

  const code = await done;
  dispose();
  return code;
}

/**
 * Evita que un error de escritura (`EIO`/`EPIPE` con la terminal cerrada por `SIGHUP`) tumbe el proceso a mitad de la parada.
 *
 * @param {NodeJS.EventEmitter[]} streams Las salidas estándar.
 */
export function installStreamErrorGuards(streams) {
  for (const stream of streams) stream.on('error', () => undefined);
}

/**
 * Cuáles de los puertos aceptan conexiones, en `127.0.0.1` y `::1`, repitiendo hasta `timeoutMs` mientras algo siga abierto.
 *
 * @param {number[]} ports Puertos.
 * @param {number} timeoutMs Margen total.
 * @returns {Promise<{ host: string, port: number }[]>} Lo que sigue escuchando al final.
 */
export async function checkPortsFree(ports, timeoutMs) {
  /** @param {string} host @param {number} port */
  const accepts = (host, port) =>
    new Promise((/** @type {(open: boolean) => void} */ resolve) => {
      const socket = connect({ host, port });
      socket.setTimeout(500);
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('timeout', () => (socket.destroy(), resolve(false)));
      socket.once('error', () => (socket.destroy(), resolve(false)));
    });
  const started = performance.now();
  for (;;) {
    const probes = ports.flatMap((port) => ['127.0.0.1', '::1'].map((host) => ({ host, port })));
    const open = await Promise.all(probes.map(({ host, port }) => accepts(host, port)));
    const busy = probes.filter((_, index) => open[index]);
    if (busy.length === 0 || performance.now() - started >= timeoutMs) return busy;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRM_SCRIPT = fileURLToPath(new URL('./crm.mjs', import.meta.url));

/**
 * El CRM como proceso hijo real: grupo propio (el Ctrl+C de la terminal solo le llega al arranque), entorno mínimo (`PATH`) y el
 * token solo por el canal IPC.
 *
 * @returns {CrmProcess} El proceso.
 */
function forkCrm() {
  const child = fork(CRM_SCRIPT, [], { detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { PATH: process.env.PATH ?? '' }, execArgv: [] });
  const exited = new Promise((/** @type {(code: number | null) => void} */ resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', () => resolve(1));
  });
  return {
    exited,
    start: (token, port) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, code: 'timeout' }), CRM_START_TIMEOUT_MS);
        const settle = (/** @type {{ ok: true } | { ok: false, code: string }} */ result) => {
          clearTimeout(timer);
          resolve(result);
        };
        child.once('exit', () => settle({ ok: false, code: 'exit' }));
        child.on('message', (/** @type {{ type?: string, code?: unknown }} */ message) => {
          if (message?.type === 'listening') settle({ ok: true });
          if (message?.type === 'failed') settle({ ok: false, code: typeof message.code === 'string' ? message.code : 'ERROR' });
        });
        child.send({ type: 'start', token, port });
      }),
    stop: () => {
      if (child.connected) child.send({ type: 'stop' });
    },
    kill: () => void child.kill('SIGKILL'),
  };
}

/**
 * `turbo run dev` en un grupo de procesos propio (turbo ignora una señal a su pid: hay que enviarla al grupo).
 *
 * @param {Record<string, string | undefined>} env Entorno de la API y la web.
 * @returns {TurboProcess} El proceso.
 */
function spawnTurbo(env) {
  const child = spawn(`${ROOT}node_modules/.bin/turbo`, ['run', 'dev', '--ui=stream'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  });
  const exited = new Promise((/** @type {(result: { code: number | null, signal: string | null }) => void} */ resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: 1, signal: null }));
  });
  return {
    exited,
    signalGroup: (signal) => {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    },
  };
}

/** @returns {DemoDeps} Las piezas reales. */
function realDeps() {
  const env = process.env;
  return {
    env,
    write: (line) => void process.stdout.write(`${line}\n`),
    createToken: createRunToken,
    launchCrm: forkCrm,
    launchTurbo: spawnTurbo,
    probeApi: async () => {
      try {
        await requestApi({ target: parseApiUrl(env.FRANCA_API_URL), method: 'GET', path: '/', signal: AbortSignal.timeout(2_000) });
        return true;
      } catch (error) {
        if (error instanceof ApiRequestError) return false;
        throw error;
      }
    },
    seed: (write) => seedDemo({ env, write }),
    checkPorts: checkPortsFree,
    onSignals: (handler) => {
      /** @type {[StopSignal, () => void][]} */
      const handlers = STOP_SIGNALS.map((signal) => [signal, () => handler(signal)]);
      for (const [signal, listener] of handlers) process.on(signal, listener);
      return () => handlers.forEach(([signal, listener]) => process.off(signal, listener));
    },
    exit: (code) => process.exit(code),
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installStreamErrorGuards([process.stdout, process.stderr]);
  process.exit(await runDemo(realDeps()));
}
