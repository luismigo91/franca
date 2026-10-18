import { FLOWS } from '../tests/helpers/engine-events';
import { sendJson } from '../tests/helpers/fake-api';
import { inspector, lastRequest, openEditor, screen } from './support/editor';
import { rawRequest } from './support/http';
import { expect, test, text } from './support/test';

type Json = Record<string, unknown>;

const HOLA = JSON.stringify(FLOWS.hola);

/** Las siete operaciones del editor y las del chat, tal como las recibe la API. */
const ALLOWED: RegExp[] = [
  /^GET \/flows\?limit=20&offset=\d+$/,
  /^GET \/flows\/[a-z][a-z0-9_-]*$/,
  /^POST \/flows$/,
  /^PUT \/flows\/[a-z][a-z0-9_-]*$/,
  /^POST \/flows\/[a-z][a-z0-9_-]*\/versions$/,
  /^DELETE \/flows\/[a-z][a-z0-9_-]*$/,
  /^POST \/conversations$/,
  // Las del chat.
  /^GET \/flows\?published=true&limit=20&offset=\d+$/,
  /^GET \/flows\/[a-z][a-z0-9_-]*\/versions\/\d+$/,
  /^GET \/conversations(\?limit=20&offset=\d+)?$/,
  /^GET \/conversations\/[0-9a-f-]{36}(\/transcript\?limit=100&offset=\d+)?$/,
  /^POST \/conversations\/[0-9a-f-]{36}\/inputs$/,
  /^DELETE \/conversations\/[0-9a-f-]{36}$/,
];

test('Recorrido del editor', async ({ page, stack }) => {
  await page.goto('/flujos');
  await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
  await page.getByLabel('Desde JSON').check();
  await page.getByLabel('JSON del flujo').fill(JSON.stringify(FLOWS['captacion-leads']));
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.waitForURL(/\/flujos\/captacion-leads$/);
  await inspector(page).getByLabel('Nombre', { exact: true }).fill('Leads v2');
  await screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  await screen(page).getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(screen(page).getByText('Publicada la versión 1.')).toBeVisible();
  await screen(page).getByRole('button', { name: 'Probar', exact: true }).click();
  await page.waitForURL(/\/conversaciones\//);
  await expect(text(page, '¡Hola! Te hago tres preguntas y te paso con la persona adecuada.')).toBeVisible();
  await page.goto('/flujos/captacion-leads');
  await page.locator('#editor-title').waitFor();
  await screen(page).getByRole('button', { name: 'Borrar flujo' }).click();
  await page.getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.waitForURL(/\/flujos$/);
  const seen = stack.fakeApi.requests.map((request) => `${request.method} ${request.path}`);
  expect(seen.length).toBeGreaterThan(5);
  for (const line of seen) expect(ALLOWED.some((pattern) => pattern.test(line)), line).toBe(true);
  expect(seen).not.toContain('POST /flows/validate');
  expect(seen.filter((line) => line.startsWith('POST /flows/') && line.endsWith('/versions'))).toHaveLength(1);
});

test('Id de flujo con una ruta dentro', async ({ page, stack }) => {
  // Una página sin datos: la de inicio del chat pediría a la API sus listas.
  await page.goto('/flujos/No%20Vale');
  const results = await page.evaluate(async (body) => {
    const out: { id: string; method: string; status: number; text: string }[] = [];
    for (const id of ['..%2Fconversations', 'Hola']) {
      const base = `/api/editor/flows/${id}`;
      const calls: [string, string, RequestInit][] = [
        ['GET', base, {}],
        ['PUT', base, { headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' }, body }],
        ['POST', `${base}/versions`, { headers: { 'If-Match': '"1"' } }],
        ['DELETE', base, { headers: { 'If-Match': '"1"' } }],
      ];
      for (const [method, url, init] of calls) {
        const response = await fetch(url, { method, ...init });
        out.push({ id, method, status: response.status, text: await response.text() });
      }
    }
    return out;
  }, HOLA);
  expect(results).toHaveLength(8);
  for (const result of results) {
    expect([result.status, result.text], `${result.method} ${result.id}`).toEqual([404, '{"error":"flow_not_found"}']);
  }
  expect(stack.fakeApi.requests).toEqual([]);
});

test('Otra web intenta guardar un flujo', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  stack.fakeApi.reset();
  const attempt = (method: string, path: string, origin: string | undefined) =>
    rawRequest({
      method,
      path,
      headers: { Host: 'localhost:3000', 'If-Match': '"1"', ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}), ...(origin === undefined ? {} : { Origin: origin }) },
      ...(method === 'PUT' ? { body: HOLA } : {}),
    });
  const calls: [string, string][] = [
    ['PUT', '/api/editor/flows/hola'],
    ['POST', '/api/editor/flows/hola/versions'],
    ['DELETE', '/api/editor/flows/hola'],
  ];
  let responses = 0;
  for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:3000', undefined]) {
    for (const [method, path] of calls) {
      const response = await attempt(method, path, origin);
      expect(response.status, `${method} ${String(origin)}`).toBe(403);
      expect(Object.keys(response.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
      responses += 1;
    }
  }
  expect(responses).toBe(12);
  expect(stack.fakeApi.requests).toEqual([]);
});

test('Host ajeno en el editor', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  stack.fakeApi.reset();
  const page = await rawRequest({ path: '/flujos', headers: { Host: 'evil.example:3000' } });
  expect(page.status).toBe(403);
  expect(page.body).not.toContain('Hola');
  const save = await rawRequest({
    method: 'PUT',
    path: '/api/editor/flows/hola',
    headers: { Host: 'evil.example:3000', Origin: 'http://evil.example:3000', 'Content-Type': 'application/json', 'If-Match': '"1"' },
    body: HOLA,
  });
  expect(save.status).toBe(403);
  expect(stack.fakeApi.requests).toEqual([]);
});

test('Cabeceras de un guardado', async ({ page, admin, stack, context }) => {
  await admin.createDraft('captacion-leads');
  stack.fakeApi.reset();
  await context.addCookies([{ name: 'sesion', value: '1', url: 'http://localhost:3000' }]);
  await page.goto('/');
  const body = JSON.stringify({ ...(FLOWS['captacion-leads'] as Json), name: 'Leads v2' });
  const status = await page.evaluate(async (text) => (await fetch('/api/editor/flows/captacion-leads', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-Extra': '1' }, body: text })).status, body);
  expect(status).toBe(200);
  const received = lastRequest(stack, 'PUT', '/flows/captacion-leads')!;
  expect(received.body).toBe(body);
  expect(received.headers.host).toBe(new URL(stack.fakeApi.url).host);
  expect(received.headers['content-type']).toBe('application/json');
  expect(received.headers['if-match']).toBe('"1"');
  for (const name of ['origin', 'cookie', 'authorization', 'referer', 'x-extra']) expect(received.headers[name], name).toBeUndefined();
});

test('Error de la API sin su mensaje', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  stack.fakeApi.respond((request, response) => {
    if (request.method !== 'PUT') return sendJson(response, 404, { message: 'x', error: 'not_found' });
    sendJson(response, 400, { message: 'MARCA-MENSAJE', error: 'invalid_flow', issues: [{ layer: 'semantic', path: '/start', message: 'MARCA-ISSUE' }], warnings: [] });
  });
  await inspector(page).getByLabel('Nombre', { exact: true }).fill('Leads v2');
  const answered = page.waitForResponse((response) => response.request().method() === 'PUT');
  await screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  expect(await (await answered).text()).toBe('{"error":"invalid_flow"}');
  await expect(screen(page).getByText('La API de Franca considera que el flujo no es válido.')).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('MARCA-MENSAJE');
  expect(body).not.toContain('MARCA-ISSUE');
});

test('Marcas fuera de los registros del editor', async ({ page, admin, stack }) => {
  const marked = structuredClone(FLOWS['captacion-leads']) as Json;
  (marked.nodes as { content: unknown }[])[0]!.content = [{ kind: 'text', text: 'MARCA-FLUJO' }];
  await admin.createDraft(marked);
  await openEditor(page, 'captacion-leads');
  const nameField = inspector(page).getByLabel('Nombre', { exact: true });
  const save = () => screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await nameField.fill('MARCA-FLUJO 2');
  await save();
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  // 412: el borrador cambia fuera del editor.
  await admin.updateDraft({ ...marked, name: 'MARCA-FLUJO fuera' });
  await nameField.fill('MARCA-FLUJO 3');
  await save();
  await expect(screen(page).getByText('El flujo ha cambiado en otra pestaña o fuera del editor.')).toBeVisible();
  // Un 5xx se registra: solo plantilla, estado y código.
  stack.fakeApi.respond((request, response) => {
    if (request.method === 'PUT') sendJson(response, 503, { message: 'MARCA-FLUJO', error: 'database_unavailable' });
    else sendJson(response, 503, { message: 'MARCA-FLUJO', error: 'database_unavailable' });
  });
  await screen(page).getByRole('button', { name: 'Guardar encima' }).click();
  await expect(screen(page).getByText('La base de datos de Franca no está disponible: no consta que se hayan guardado los cambios.')).toBeVisible();
  stack.fakeApi.respond(null);
  stack.fakeApi.forwardTo(Number(new URL(stack.realApiUrl).port));
  // 404: el flujo se borra fuera del editor.
  await admin.deleteFlow('captacion-leads');
  await save();
  await expect(screen(page).getByText(/se ha borrado fuera del editor/)).toBeVisible();
  await screen(page).getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.reload().catch(() => undefined);
  const output = stack.webOutput();
  expect(output).not.toContain('MARCA-FLUJO');
  expect(output).toContain('[web] PUT /api/editor/flows/[flowId] 503 database_unavailable');
  const stored = await page.evaluate(async () => ({
    cookies: document.cookie,
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases: (await indexedDB.databases()).map((database) => database.name),
  }));
  expect(stored).toEqual({ cookies: '', local: [], session: [], databases: [] });
  expect(await page.context().cookies()).toEqual([]);
});
