'use strict';

// `Host` local: la misma regla que `apps/api/src/http/local-only.ts`. Es CommonJS para que lo cargue tanto
// `src/server/frontier.ts` como `scripts/local-only-preload.cjs` (`--require`, en cualquier Node 22).

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const PORT = /^:[0-9]{1,5}$/;

/**
 * Indica si una cabecera `Host` nombra la máquina local: `localhost`, `127.0.0.1` o `[::1]`, con puerto opcional y
 * sin distinguir mayúsculas. Comparación exacta del nombre (`localhost.evil.example`, `localhost.` o
 * `127.0.0.1.nip.io` no valen: un DNS rebinding no debe poder usar la web).
 *
 * @param {string | null | undefined} host Valor **en bruto** de la cabecera `host`.
 * @returns {boolean} `true` si es un nombre local.
 */
function isLocalHost(host) {
  if (typeof host !== 'string' || host === '') return false;
  const value = host.toLowerCase();
  const end = value.startsWith('[') ? value.indexOf(']') + 1 : value.indexOf(':');
  const name = end <= 0 ? value : value.slice(0, end);
  const rest = end <= 0 ? '' : value.slice(end);
  return LOCAL_NAMES.has(name) && (rest === '' || PORT.test(rest));
}

module.exports = { isLocalHost };
