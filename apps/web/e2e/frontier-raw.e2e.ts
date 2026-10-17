import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { finalStatusLine, headerOf, rawBytes, statusLine } from './support/http';
import { descendants, isListening, listeningDiagnostics, listeningPorts, WEB_DIR } from './support/processes';
import { startWeb } from './support/stack';
import { expect, test } from './support/test';

// QA adversarial de la frontera contra el servidor real (R2): las variantes que `fetch` y `http.request` no dejan mandar.
// Complementa `frontier.e2e.ts`, que ya cubre un Host ajeno, el Origin de un POST, los marcos y las interfaces.

const ID = '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90';
const OWN = 'http://127.0.0.1:3000';

const get = (path: string, hosts: string[], extra = '', version = '1.1') =>
  `GET ${path} HTTP/${version}\r\n${hosts.map((host) => `Host: ${host}\r\n`).join('')}${extra}Connection: close\r\n\r\n`;
const post = (path: string, host: string, origin: string | undefined, extra = '') =>
  `POST ${path} HTTP/1.1\r\nHost: ${host}\r\n${origin === undefined ? '' : `Origin: ${origin}\r\n`}Content-Type: application/json\r\nContent-Length: 2\r\n${extra}Connection: close\r\n\r\n{}`;

/** Un fichero JavaScript real de `.next/static`, para probar una respuesta estática con 200. */
function aStaticChunk(): string {
  const dir = join(WEB_DIR, '.next', 'static', 'chunks');
  const file = readdirSync(dir).find((name) => name.endsWith('.js'));
  if (file === undefined) throw new Error('falta un chunk en .next/static: el E2E arranca la web ya compilada');
  return `/_next/static/chunks/${file}`;
}

test('Host en bruto: la matriz contra next start', async ({ stack }) => {
  const forbidden = ['127.0.0.1.:3000', 'localhost.:3000', '::1', '[::1]x:3000', '127.0.0.1:', '127.0.0.1:0x50', '127.1', '0x7f.1', '2130706433', 'evil.com@127.0.0.1:3000', '127.0.0.1@evil.com', '[::ffff:127.0.0.1]:3000', ''];
  for (const host of forbidden) {
    const raw = await rawBytes(get('/', [host]));
    expect(statusLine(raw), JSON.stringify(host)).toBe('HTTP/1.1 403 Forbidden');
    expect(headerOf(raw, 'x-frame-options'), JSON.stringify(host)).toBe('DENY');
  }
  for (const host of ['127.0.0.1:3000', '127.0.0.1', 'LocalHost:3000', '[::1]:3000', 'localhost']) {
    expect(statusLine(await rawBytes(get('/', [host]))), host).toBe('HTTP/1.1 200 OK');
  }
  // Un Host ajeno delante de uno local no se salva con el segundo; sin Host en HTTP/1.0 es 403.
  expect(statusLine(await rawBytes(get('/', ['evil.example', '127.0.0.1:3000'])))).toBe('HTTP/1.1 403 Forbidden');
  expect(statusLine(await rawBytes(get('/', [], '', '1.0')))).toBe('HTTP/1.1 403 Forbidden');
  expect(stack.fakeApi.requests).toEqual([]);
});

test('Cabeceras que se fían de un proxy no cuentan', async ({ stack }) => {
  const forwarded = 'X-Forwarded-Host: 127.0.0.1:3000\r\nX-Forwarded-For: 127.0.0.1\r\nForwarded: for=127.0.0.1;host=127.0.0.1:3000\r\nX-Forwarded-Proto: http\r\nX-Real-Ip: 127.0.0.1\r\n';
  expect(statusLine(await rawBytes(get('/', ['evil.example'], forwarded)))).toBe('HTTP/1.1 403 Forbidden');
  expect(statusLine(await rawBytes(post('/api/conversations', 'evil.example', 'http://evil.example', forwarded)))).toBe('HTTP/1.1 403 Forbidden');
  expect(statusLine(await rawBytes(get('/', ['127.0.0.1:3000'], 'X-Forwarded-Host: evil.example\r\n')))).toBe('HTTP/1.1 200 OK');
  expect(stack.fakeApi.requests).toEqual([]);
});

test('Origin en bruto: ningún método que no sea GET o HEAD pasa sin el propio', async ({ stack }) => {
  const rejected: Array<[string, string | undefined]> = [
    ['ausente', undefined],
    ['null', 'null'],
    ['otro puerto', 'http://127.0.0.1:3001'],
    ['https', 'https://127.0.0.1:3000'],
    ['esquema en mayúsculas', 'HTTP://127.0.0.1:3000'],
    ['host en mayúsculas', 'http://LOCALHOST:3000'],
    ['localhost con Host 127.0.0.1', 'http://localhost:3000'],
    ['con barra final', `${OWN}/`],
    ['ajeno', 'http://evil.example'],
  ];
  for (const [label, origin] of rejected) {
    const raw = await rawBytes(post('/api/conversations', '127.0.0.1:3000', origin));
    expect(statusLine(raw), label).toBe('HTTP/1.1 403 Forbidden');
    expect(headerOf(raw, 'access-control-allow-origin'), label).toBeUndefined();
  }
  // Dos cabeceras Origin: Node las junta con una coma y deja de ser el propio.
  const twice = `POST /api/conversations HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nOrigin: ${OWN}\r\nOrigin: http://evil.example\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`;
  expect(statusLine(await rawBytes(twice))).toBe('HTTP/1.1 403 Forbidden');
  for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const raw = await rawBytes(`${method} /api/conversations/${ID} HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    expect(statusLine(raw), method).toBe('HTTP/1.1 403 Forbidden');
  }
  expect(stack.fakeApi.requests).toEqual([]);
  // Con el propio, el POST llega a la API simulada.
  expect(statusLine(await rawBytes(post('/api/conversations', '127.0.0.1:3000', OWN)))).not.toBe('HTTP/1.1 403 Forbidden');
});

test('Un GET desde otro origen se atiende sin cabeceras CORS', async () => {
  const raw = await rawBytes(get('/api/conversations', ['127.0.0.1:3000'], 'Origin: http://evil.example\r\n'));
  expect(finalStatusLine(raw)).not.toBe('HTTP/1.1 403 Forbidden');
  expect(Object.keys(Object.fromEntries((raw.split('\r\n\r\n')[0] ?? '').split('\r\n').slice(1).map((line) => [line.split(':')[0]!.toLowerCase(), 1]))).filter((name) => name.startsWith('access-control-'))).toEqual([]);
});

test('Marcos y política de referencia en toda respuesta, estáticos y errores incluidos', async () => {
  const chunk = aStaticChunk();
  const paths = ['/', '/nada', '/api/otra', `/api/conversations/${ID}`, '/api/conversations/no-es-un-uuid', '/api/conversations/%zz', '/favicon.ico', '/conversaciones/no-es-un-uuid', chunk, '/_next/static/chunks/no-existe.js'];
  for (const path of paths) {
    const raw = await rawBytes(get(path, ['127.0.0.1:3000']));
    expect(headerOf(raw, 'content-security-policy'), path).toContain("frame-ancestors 'none'");
    expect(headerOf(raw, 'x-frame-options'), path).toBe('DENY');
    expect(headerOf(raw, 'referrer-policy'), path).toBe('no-referrer');
    expect(headerOf(raw, 'x-content-type-options'), path).toBe('nosniff');
    expect(headerOf(raw, 'access-control-allow-origin'), path).toBeUndefined();
  }
  // Las páginas y las operaciones nunca se guardan; solo los estáticos con hash.
  for (const path of ['/', '/api/conversations', '/api/otra', `/api/conversations/${ID}`]) {
    expect(headerOf(await rawBytes(get(path, ['127.0.0.1:3000'])), 'cache-control'), path).toContain('no-store');
  }
  expect(headerOf(await rawBytes(get(chunk, ['127.0.0.1:3000'])), 'cache-control')).not.toContain('no-store');
  // También el 403 de un Host ajeno, que sale de la guarda del proceso y no de proxy.ts.
  for (const path of ['/', chunk, '/__nextjs_attach-nodejs-inspector']) {
    const raw = await rawBytes(get(path, ['evil.example']));
    expect(statusLine(raw), path).toBe('HTTP/1.1 403 Forbidden');
    expect(headerOf(raw, 'x-frame-options'), path).toBe('DENY');
    expect(headerOf(raw, 'content-security-policy'), path).toContain("frame-ancestors 'none'");
  }
});

test('Expect: 100-continue, upgrade y CONNECT con un Host o un Origin malos no llegan a la ruta', async ({ stack }) => {
  const expectation = (host: string, origin: string) =>
    `POST /api/conversations HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nExpect: 100-continue\r\nContent-Type: application/json\r\nContent-Length: 21\r\nConnection: close\r\n\r\n{"flowId":"pregunta"}`;
  expect(finalStatusLine(await rawBytes(expectation('evil.example', 'http://evil.example')))).toBe('HTTP/1.1 403 Forbidden');
  expect(finalStatusLine(await rawBytes(expectation('127.0.0.1:3000', 'http://evil.example')))).toBe('HTTP/1.1 403 Forbidden');
  const upgrade = (host: string, origin?: string) =>
    `GET /_next/webpack-hmr HTTP/1.1\r\nHost: ${host}\r\n${origin === undefined ? '' : `Origin: ${origin}\r\n`}Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${'A'.repeat(22)}==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
  expect(statusLine(await rawBytes(upgrade('evil.example', 'http://evil.example')))).toBe('HTTP/1.1 403 Forbidden');
  expect(statusLine(await rawBytes(upgrade('127.0.0.1:3000')))).toBe('HTTP/1.1 403 Forbidden');
  expect(statusLine(await rawBytes(upgrade('127.0.0.1:3000', 'http://127.0.0.1:5173')))).toBe('HTTP/1.1 403 Forbidden');
  const connect = (host: string, origin?: string) => `CONNECT example.com:443 HTTP/1.1\r\nHost: ${host}\r\n${origin === undefined ? '' : `Origin: ${origin}\r\n`}\r\n`;
  for (const request of [connect('evil.example', 'http://evil.example'), connect('127.0.0.1:3000'), connect('127.0.0.1:3000', 'http://evil.example')]) {
    expect(statusLine(await rawBytes(request)), request).not.toMatch(/^HTTP\/1\.[01] 200/);
  }
  expect(stack.fakeApi.requests).toEqual([]);
});

test('next dev: los recursos de desarrollo con un Host local no abren el inspector ni ningún otro puerto', async ({ stack }) => {
  test.setTimeout(240_000);
  await stack.stopWeb();
  const web = await startWeb('dev', { FRANCA_API_URL: stack.fakeApi.url });
  try {
    for (const method of ['GET', 'POST', 'PUT']) {
      const origin = method === 'GET' ? '' : `Origin: ${OWN}\r\n`;
      const raw = await rawBytes(`${method} /__nextjs_attach-nodejs-inspector HTTP/1.1\r\nHost: 127.0.0.1:3000\r\n${origin}Content-Length: 0\r\nConnection: close\r\n\r\n`);
      expect(finalStatusLine(raw), method).not.toBe('HTTP/1.1 200 OK');
      expect(raw, method).not.toMatch(/devtoolsFrontendUrl|ws=|:9229/);
    }
    expect(await isListening(9229), 'el inspector no debe estar en el 9229').toBe(false);
    const ports = listeningPorts(descendants(web.child.pid!));
    if (ports !== null) expect(ports.filter((port, index) => ports.indexOf(port) === index), listeningDiagnostics(web.child.pid!)).toEqual(['127.0.0.1:3000']);
    // Los recursos de desarrollo con un Host ajeno ni se miran.
    for (const path of ['/__nextjs_attach-nodejs-inspector', '/__nextjs_launch-editor?file=package.json', '/__nextjs_original-stack-frames', '/_next/webpack-hmr']) {
      const raw = await rawBytes(get(path, ['evil.example:3000']));
      expect(statusLine(raw), path).toBe('HTTP/1.1 403 Forbidden');
    }
    // El websocket de recarga solo con el Origin propio.
    const upgrade = (origin?: string) =>
      `GET /_next/webpack-hmr HTTP/1.1\r\nHost: localhost:3000\r\n${origin === undefined ? '' : `Origin: ${origin}\r\n`}Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${'A'.repeat(22)}==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
    expect(statusLine(await rawBytes(upgrade('http://localhost:5173')))).toBe('HTTP/1.1 403 Forbidden');
    expect(statusLine(await rawBytes(upgrade()))).toBe('HTTP/1.1 403 Forbidden');
    expect(web.output()).not.toMatch(/Debugger listening|ws:\/\/127\.0\.0\.1:9229/);
  } finally {
    await web.stop();
    await stack.restartWeb();
  }
});
