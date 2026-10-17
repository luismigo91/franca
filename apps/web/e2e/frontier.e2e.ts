import { networkInterfaces } from 'node:os';
import { CONVERSATION_ID } from './support/api-shapes';
import { rawRequest } from './support/http';
import { descendants, isListening, launch, listeningDiagnostics, listeningPorts, REPO_DIR, waitFor } from './support/processes';
import { startWeb } from './support/stack';
import { answer, expect, test, text, tryFlow } from './support/test';
import { sendJson } from '../tests/helpers/fake-api';


/** Una dirección IPv4 de la máquina que no es de loopback, si la hay. */
function externalAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address;
  }
  return undefined;
}

test('Otra interfaz de la máquina', async ({ stack }) => {
  test.setTimeout(240_000);
  const address = externalAddress();
  test.skip(address === undefined, 'la máquina no tiene una dirección de red distinta de loopback');
  try {
    for (const script of ['start', 'dev'] as const) {
      await stack.stopWeb();
      const web = await startWeb(script, { FRANCA_API_URL: stack.fakeApi.url });
      try {
        expect(await isListening(3000, address!), `${script}: la dirección ${address} no debe aceptar conexiones`).toBe(false);
        expect((await rawRequest({ path: '/', headers: { Host: 'localhost:3000' } })).status, script).toBe(200);
        if (script === 'dev') {
          // Solo con `Host: evil.example`: con un Host local se abriría el inspector si faltara el parche (D26).
          const inspector = await rawRequest({ path: '/__nextjs_attach-nodejs-inspector', headers: { Host: 'evil.example:3000' } });
          expect(inspector.status).toBe(403);
          expect(inspector.body).toBe('');
          const ports = listeningPorts(descendants(web.child.pid!));
          if (ports !== null) expect(ports.filter((port, index) => ports.indexOf(port) === index), listeningDiagnostics(web.child.pid!)).toEqual(['127.0.0.1:3000']);
        }
      } finally {
        await web.stop();
      }
    }
  } finally {
    await stack.restartWeb();
  }
});

test('Host ajeno', async ({ admin, stack }) => {
  await admin.publish('pregunta');
  const home = await rawRequest({ path: '/', headers: { Host: 'evil.example:3000' } });
  expect(home.status).toBe(403);
  expect(home.body).not.toContain('Pregunta');
  const create = await rawRequest({
    method: 'POST',
    path: '/api/conversations',
    headers: { Host: 'evil.example:3000', Origin: 'http://evil.example:3000', 'Content-Type': 'application/json' },
    body: '{"flowId":"pregunta"}',
  });
  expect(create.status).toBe(403);
  expect(stack.fakeApi.requests).toEqual([]);
});

test('Nombres locales', async () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST:3000']) expect((await rawRequest({ path: '/', headers: { Host: host } })).status, host).toBe(200);
  for (const host of ['localhost.evil.example:3000', '127.0.0.1.nip.io:3000']) expect((await rawRequest({ path: '/', headers: { Host: host } })).status, host).toBe(403);
});

test('Otra web intenta crear una conversación', async ({ admin, stack }) => {
  await admin.publish('pregunta');
  const create = (origin?: string) =>
    rawRequest({ method: 'POST', path: '/api/conversations', headers: { Host: 'localhost:3000', 'Content-Type': 'application/json', ...(origin === undefined ? {} : { Origin: origin }) }, body: '{"flowId":"pregunta"}' });
  for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:3000', undefined]) {
    const response = await create(origin);
    expect(response.status, String(origin)).toBe(403);
    expect(Object.keys(response.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  }
  expect(stack.fakeApi.requests).toEqual([]);
  const allowed = await create('http://localhost:3000');
  expect(allowed.status).toBe(201);
  expect(stack.fakeApi.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['POST /conversations']);
});

test.describe('marcos', () => {
  test.use({ allowFrameAncestorsError: true });

  test('El chat dentro de un marco ajeno', async ({ page, context, stack }) => {
    // La página contenedora la sirve la API simulada (otro puerto de 127.0.0.1): se deja pasar solo en este test.
    await context.route(`${stack.fakeApi.url}/**`, (route) => route.continue());
    stack.fakeApi.respond((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>contenedor</title><iframe id="chat" src="http://localhost:3000/" width="600" height="400"></iframe>');
    });
    await page.goto(`${stack.fakeApi.url}/contenedor`);
    await page.waitForTimeout(1500);
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
    expect(frame).toBeDefined();
    expect(await frame!.content()).not.toContain('Franca');
    const response = await rawRequest({ path: '/', headers: { Host: 'localhost:3000' } });
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-frame-options']).toBe('DENY');
  });
});

test('Recorrido completo', async ({ page, admin, stack }) => {
  await admin.publish('captacion-leads');
  await tryFlow(page, 'Captación de leads');
  await text(page, '¿Cómo te llamas?').waitFor();
  await answer(page, 'Ana');
  await text(page, '¿A qué email te escribimos?').waitFor();
  await answer(page, 'ana@example.com');
  await page.getByRole('button', { name: 'Más de 50' }).click();
  await text(page, 'La conversación no ha podido continuar').waitFor();
  await page.reload();
  await text(page, 'La conversación no ha podido continuar').waitFor();
  await page.getByRole('button', { name: 'Empezar de nuevo' }).click();
  await page.waitForFunction(() => !document.querySelector('main h1')?.textContent?.includes('…'));
  await text(page, '¿Cómo te llamas?').waitFor();
  await page.getByRole('button', { name: 'Borrar conversación' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.waitForURL(/\/$/);
  await page.getByRole('heading', { name: 'Conversaciones recientes' }).waitFor();
  await page.waitForTimeout(300);
  const allowed = [
    /^GET \/flows\?published=true&limit=20&offset=\d+$/,
    /^GET \/flows\/[a-z0-9_-]+\/versions\/\d+$/,
    /^GET \/conversations\?limit=20&offset=\d+$/,
    /^GET \/conversations\/[0-9a-f-]{36}$/,
    /^GET \/conversations\/[0-9a-f-]{36}\/transcript\?limit=100&offset=\d+$/,
    /^POST \/conversations$/,
    /^POST \/conversations\/[0-9a-f-]{36}\/inputs$/,
    /^DELETE \/conversations\/[0-9a-f-]{36}$/,
  ];
  const seen = stack.fakeApi.requests.map((request) => `${request.method} ${request.path}`);
  expect(seen.length).toBeGreaterThan(8);
  for (const request of seen) expect(allowed.some((pattern) => pattern.test(request)), request).toBe(true);
});

test('Id de conversación con una ruta dentro', async ({ page, stack }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const out: Array<[number, string]> = [];
    for (const id of ['..%2F..%2Fflows%2Fhola', '00000000-0000-4000-8000-00000000000A']) {
      const send = await fetch(`/api/conversations/${id}/inputs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: '{"input":{"text":"a"}}' });
      out.push([send.status, await send.text()]);
      const remove = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      out.push([remove.status, await remove.text()]);
    }
    return out;
  });
  expect(results).toHaveLength(4);
  for (const [status, body] of results) {
    expect(status).toBe(404);
    expect(JSON.parse(body)).toEqual({ error: 'conversation_not_found' });
  }
  expect(stack.fakeApi.requests.filter((request) => request.path.includes('flows/hola') || request.path.includes('00000000'))).toEqual([]);
});

test('Cabeceras que recibe la API', async ({ page, context, stack }) => {
  stack.fakeApi.respond((_request, response) => sendJson(response, 409, { message: 'x', error: 'conversation_busy' }));
  await context.addCookies([{ name: 'sesion', value: '1', url: 'http://localhost:3000' }]);
  await page.goto('/');
  await page.evaluate(async (id) => {
    await fetch(`/api/conversations/${id}/inputs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-Extra': '1' }, body: '{"input":{"text":"a"}}' });
  }, CONVERSATION_ID);
  const request = stack.fakeApi.requests.find((candidate) => candidate.path === `/conversations/${CONVERSATION_ID}/inputs`)!;
  expect(request.method).toBe('POST');
  expect(request.headers.host).toBe(new URL(stack.fakeApi.url).host);
  expect(request.headers['content-type']).toBe('application/json');
  expect(request.headers['if-match']).toBe('"1"');
  for (const name of ['origin', 'cookie', 'authorization', 'referer', 'x-extra']) expect(request.headers[name], name).toBeUndefined();
});

test('Direcciones no admitidas', async ({ stack }) => {
  test.setTimeout(240_000);
  await stack.stopWeb();
  try {
    for (const value of ['https://127.0.0.1:3001', 'http://api.example.com:3001', 'http://127.0.0.1:3001/v1', 'http://u:p@127.0.0.1:3001', '127.0.0.1:3001', '']) {
      const web = launch('pnpm', ['--filter', '@franca/web', 'start'], { cwd: REPO_DIR, env: { PATH: process.env.PATH, HOME: process.env.HOME, FRANCA_API_URL: value } });
      await waitFor(() => web.child.exitCode !== null, `que la web salga con FRANCA_API_URL=${JSON.stringify(value)}`, 30_000);
      expect(web.child.exitCode, JSON.stringify(value)).not.toBe(0);
      expect(web.output()).toContain('FRANCA_API_URL');
      expect(web.output()).not.toContain('api.example.com');
      expect(await isListening(3000), `nada debe escuchar con ${JSON.stringify(value)}`).toBe(false);
      await web.stop();
    }
    for (const value of ['http://localhost:3001', 'http://[::1]:3001', undefined]) {
      const web = await startWeb('start', { FRANCA_API_URL: value });
      expect((await rawRequest({ path: '/', headers: { Host: 'localhost:3000' } })).status).toBe(200);
      await web.stop();
      await waitFor(async () => !(await isListening(3000)), 'que el 3000 quede libre', 20_000);
    }
  } finally {
    await stack.restartWeb();
  }
});

test('Marcas fuera de los registros y del navegador', async ({ page, admin, stack }) => {
  await admin.publish('captacion-leads');
  await tryFlow(page, 'Captación de leads', 'c-marca');
  await text(page, '¿Cómo te llamas?').waitFor();
  await answer(page, 'MARCA-NOMBRE');
  await text(page, '¿A qué email te escribimos?').waitFor();
  await answer(page, 'marca@example.com');
  await text(page, '¿Cuántas personas sois en la empresa?').waitFor();
  await page.reload();
  await text(page, '¿Cuántas personas sois en la empresa?').waitFor();
  const output = stack.webOutput();
  for (const mark of ['MARCA-NOMBRE', 'marca@example.com', 'c-marca']) expect(output, mark).not.toContain(mark);
  expect(await page.context().cookies()).toEqual([]);
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases: (await indexedDB.databases()).map((database) => database.name),
  }));
  expect(storage).toEqual({ local: [], session: [], databases: [] });
});
