'use strict';

// Proceso hijo de `tests/local-only-preload.test.ts`: se lanza con `node --require scripts/local-only-preload.cjs
// --inspect-port=0` (si el preload no neutraliza `inspector.open`, el inspector se abriría en un puerto de loopback
// aleatorio: el test mata al hijo siempre). Un `http.createServer` propio con listeners para los cinco eventos, y un
// informe de lo que pasa con el inspector, incluso por el camino que usa Next.
const http = require('node:http');
const path = require('node:path');
const inspector = require('node:inspector');
const inspectorPromises = require('node:inspector/promises');

// Nunca sobrevive al test: sale si el padre cierra el pipe de entrada (muere con él) o a los 60 s.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdin.resume();
setTimeout(() => process.exit(0), 60_000);

const server = http.createServer((request, response) => {
  response.end('ok');
});
server.on('checkContinue', (request, response) => {
  response.writeContinue();
  response.end('continued');
});
server.on('checkExpectation', (request, response) => {
  response.end('expectation');
});
server.on('upgrade', (request, socket) => {
  socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
});
server.on('connect', (request, socket) => {
  socket.end('HTTP/1.1 200 Connection Established\r\n\r\n');
});

function throwsOnOpen(target) {
  try {
    target.open(0);
    return false;
  } catch {
    return true;
  }
}

/** La función que usa `next` (en `@swc/helpers`), tal como la resuelve desde `next`. */
function wildcardOf(moduleName) {
  const nextDir = path.dirname(require.resolve('next/package.json'));
  const helper = require(require.resolve('@swc/helpers/_/_interop_require_wildcard', { paths: [nextDir] }));
  return helper._(require(moduleName));
}

/** El middleware real de Next que abre el inspector, con una respuesta falsa. */
function runNextMiddleware() {
  return new Promise((resolve) => {
    const { getAttachNodejsDebuggerMiddleware } = require('next/dist/next-devtools/server/attach-nodejs-debugger-middleware');
    const response = {
      statusCode: 200,
      body: '',
      setHeader() {},
      end(chunk) {
        resolve({ status: this.statusCode, body: String(chunk ?? '') });
      },
    };
    getAttachNodejsDebuggerMiddleware()({ url: '/__nextjs_attach-nodejs-inspector' }, response, () => resolve({ status: 0, body: 'next()' }));
  });
}

server.listen(0, '127.0.0.1', async () => {
  const report = {
    openThrows: throwsOnOpen(inspector),
    promisesOpenThrows: throwsOnOpen(inspectorPromises),
    wildcardOpenThrows: throwsOnOpen(wildcardOf('inspector')),
    wildcardPrefixedOpenThrows: throwsOnOpen(wildcardOf('node:inspector')),
    middleware: await runNextMiddleware(),
    url: inspector.url() ?? null,
  };
  process.stdout.write(`PORT=${server.address().port}\n`);
  process.stdout.write(`REPORT=${JSON.stringify(report)}\n`);
});
