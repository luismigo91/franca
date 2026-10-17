'use strict';

// Guarda local dentro del proceso de Next (D26). Se carga con `--require` desde `scripts/local-only.mjs` en TODO
// proceso de Node que lance Next (la CLI, `next-server` y el worker de Turbopack).
//
// En `next dev`, los recursos de desarrollo (`/__nextjs_*`) se atienden antes de `proxy.ts`, y uno abre el inspector de
// Node. Un guardián delante no lo cierra (el puerto real atiende con cualquier `Host`), así que la guarda va dentro:
//   1. `inspector.open` lanza: el inspector no se abre desde Next.
//   2. `writeContinue` no escribe el `100 Continue` a un `Host` ajeno.
//   3. Todo `http.Server` y `https.Server` del proceso rechaza un `Host` no local (403) en los cinco eventos con los
//      que Node entrega una petición, y pone `frame-ancestors 'none'` y `X-Frame-Options: DENY` a las respuestas.
//   4. En `upgrade` y `connect` exige además el `Origin` propio: el websocket de HMR no tiene CORS.

const http = require('node:http');
const https = require('node:https');
const inspector = require('node:inspector');
const inspectorPromises = require('node:inspector/promises');
const { isLocalHost } = require('../src/server/config/local-host.cjs');

const FRAME_HEADERS = { 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' };
const GUARDED_REQUEST_EVENTS = new Set(['request', 'checkContinue', 'checkExpectation']);
const GUARDED_UPGRADE_EVENTS = new Set(['upgrade', 'connect']);

function disabledOpen() {
  throw new Error('El inspector de Node está desactivado en la web de Franca.');
}

for (const target of [inspector, inspectorPromises]) target.open = disabledOpen;

/** `Origin` exactamente igual a `http://` y el `Host` en minúsculas. */
function originIsOwn(headers) {
  return headers.origin === 'http://' + String(headers.host).toLowerCase();
}

function rejectRequest(response) {
  for (const [name, value] of Object.entries(FRAME_HEADERS)) response.setHeader(name, value);
  response.statusCode = 403;
  response.setHeader('Content-Length', '0');
  response.end();
}

function rejectUpgrade(socket) {
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  socket.destroy();
}

function guard(prototype) {
  const emit = prototype.emit;
  prototype.emit = function guardedEmit(event, ...args) {
    if (GUARDED_REQUEST_EVENTS.has(event)) {
      const [request, response] = args;
      if (!isLocalHost(request.headers.host)) {
        rejectRequest(response);
        return true;
      }
      for (const [name, value] of Object.entries(FRAME_HEADERS)) response.setHeader(name, value);
    } else if (GUARDED_UPGRADE_EVENTS.has(event)) {
      const [request, socket] = args;
      if (!isLocalHost(request.headers.host) || !originIsOwn(request.headers)) {
        rejectUpgrade(socket);
        return true;
      }
    }
    return emit.call(this, event, ...args);
  };
}

// Sin listener de `checkContinue` (la forma en que Next crea su servidor), Node escribe `100 Continue` ANTES de emitir
// `request`: la guarda de `request` llegaría tarde. Un `Host` ajeno no recibe el `100`, solo el 403.
const writeContinue = http.ServerResponse.prototype.writeContinue;
http.ServerResponse.prototype.writeContinue = function guardedWriteContinue(callback) {
  if (this.req && !isLocalHost(this.req.headers.host)) return;
  return writeContinue.call(this, callback);
};

guard(http.Server.prototype);
guard(https.Server.prototype);
