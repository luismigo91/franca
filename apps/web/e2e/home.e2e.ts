import { FLOWS } from '../tests/helpers/engine-events';
import { PREGUNTAS_HASTA_PLAN } from './support/admin';
import { answer, answerBox, expect, panel, test, text, tryFlow } from './support/test';

type Json = Record<string, unknown>;

test('Marca en la página de inicio', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Franca/);
  const body = await page.locator('body').innerText();
  for (const forbidden of ['@franca/', 'franca-web', 'Create Next App']) expect(body).not.toContain(forbidden);
  expect(await page.content()).not.toContain('@franca/');
});

test('Solo los publicados', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  const changed = structuredClone(FLOWS['captacion-leads']) as Json;
  const node = (changed.nodes as Json[])[0]!;
  (node.content as Json[])[0] = { kind: 'text', text: 'Hola, borrador sin publicar.' };
  await admin.updateDraft(changed);
  await admin.publish('pregunta');
  await admin.createDraft('hola');
  await page.goto('/');
  const items = page.locator('#flows-heading + * li');
  await expect(items).toHaveCount(2);
  const captacion = items.filter({ hasText: 'Captación de leads' });
  await expect(captacion).toContainText('Versión 1');
  await expect(captacion).toContainText('Cambios sin publicar');
  const pregunta = items.filter({ hasText: 'Pregunta' });
  await expect(pregunta).toContainText('Versión 1');
  await expect(pregunta).not.toContainText('Cambios sin publicar');
  await expect(page.getByText('Hola', { exact: true })).toHaveCount(0);
});

test('Más de una página de flujos', async ({ page, admin }) => {
  for (let index = 1; index <= 21; index++) {
    await admin.publish({ ...(FLOWS.hola as Json), id: `hola-${String(index).padStart(2, '0')}`, name: `Hola ${index}` });
  }
  await page.goto('/');
  const items = page.locator('#flows-heading + * li');
  await expect(items).toHaveCount(20);
  await page.getByRole('button', { name: 'Ver más flujos' }).click();
  await expect(items).toHaveCount(21);
  const names = await items.locator('p.font-medium').allInnerTexts();
  expect(new Set(names).size).toBe(21);
  await expect(page.getByRole('button', { name: 'Ver más flujos' })).toHaveCount(0);
});

test('Sin flujos publicados', async ({ page }) => {
  await page.goto('/');
  await expect(text(page, 'Todavía no hay flujos publicados. Publica uno con la API de Franca y vuelve.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Probar/ })).toHaveCount(0);
});

test('API parada', async ({ page, admin, stack }) => {
  await admin.publish('pregunta');
  await stack.fakeApi.stop();
  await page.goto('/');
  await expect(text(page, 'No se puede conectar con la API de Franca.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' }).first()).toBeVisible();
  await stack.fakeApi.start();
  await page.getByRole('button', { name: 'Reintentar' }).first().click();
  await expect(page.getByRole('button', { name: 'Probar Pregunta', exact: true })).toBeVisible();
});

test('Conversación terminada en la lista', async ({ page, admin }) => {
  await admin.publish('preguntas');
  await admin.publish('pregunta');
  const finished = await admin.createConversation('preguntas');
  await admin.sendAll(finished.id, [...PREGUNTAS_HASTA_PLAN, { choice: 'pro' }, { choices: ['a'] }]);
  expect((await admin.conversation(finished.id)).outcome).toBe('completo');
  await admin.createConversation('pregunta');
  await page.goto('/');
  const links = page.locator('#conversations-heading + * a');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toContainText('pregunta');
  await expect(links.nth(0)).toContainText('En espera');
  await expect(links.nth(1)).toContainText('preguntas');
  await expect(links.nth(1)).toContainText('Terminada');
  await expect(links.nth(1)).toContainText('completo');
  await links.nth(1).click();
  await expect(page).toHaveURL(new RegExp(`/conversaciones/${finished.id}$`));
});

test('Probar el ejemplo de captación de leads', async ({ page, admin, stack }) => {
  await admin.publish('captacion-leads');
  await tryFlow(page, 'Captación de leads');
  const creation = stack.fakeApi.requests.find((request) => request.method === 'POST' && request.path === '/conversations');
  expect(creation?.body).toBe('{"flowId":"captacion-leads"}');
  await expect(page).toHaveURL(/\/conversaciones\/[0-9a-f-]{36}$/);
  await expect(text(page, '¡Hola! Te hago tres preguntas y te paso con la persona adecuada.')).toBeVisible();
  await expect(text(page, '¿Cómo te llamas?')).toBeVisible();
  await expect(answerBox(page)).toBeVisible();
});

test('El email pasa de un flujo a otro', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  await admin.publish('saludo-contacto');
  await tryFlow(page, 'Captación de leads', 'c-1');
  await text(page, '¿Cómo te llamas?').waitFor();
  await answer(page, 'Ana');
  await text(page, '¿A qué email te escribimos?').waitFor();
  await answer(page, 'ana@example.com');
  await text(page, '¿Cuántas personas sois en la empresa?').waitFor();
  const firstUrl = page.url();
  await expect(panel(page)).toContainText('c-1');
  await tryFlow(page, 'Saludo', 'c-1');
  await expect(text(page, 'Hola, ana@example.com.')).toBeVisible();
  await expect(panel(page)).toContainText('c-1');
  await page.goto(firstUrl);
  await expect(panel(page)).toContainText('c-1');
});

test('Identificador de contacto no admitido', async ({ page, admin }) => {
  await admin.publish('pregunta');
  const before = (await admin.listConversations()).total;
  await page.goto('/');
  await page.getByLabel('Identificador de contacto').fill('ana@example.com');
  await page.getByRole('button', { name: 'Probar Pregunta', exact: true }).click();
  await expect(page.getByLabel('Identificador de contacto')).toHaveAttribute('aria-invalid', 'true');
  await expect(text(page, /El identificador de contacto no es válido/)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect((await admin.listConversations()).total).toBe(before);
});

test('Flujo borrado después de cargar la lista', async ({ page, admin }) => {
  await admin.publish('pregunta');
  await page.goto('/');
  await page.getByRole('button', { name: 'Probar Pregunta', exact: true }).waitFor();
  await admin.deleteFlow('pregunta');
  await page.getByRole('button', { name: 'Probar Pregunta', exact: true }).click();
  await expect(text(page, 'Ese flujo ya no existe.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Probar Pregunta', exact: true })).toHaveCount(0);
});

test('Conversación creada fuera del chat', async ({ page, admin }) => {
  await admin.publish('pregunta');
  await page.goto('/');
  await expect(text(page, 'Aún no se ha probado ningún flujo.')).toBeVisible();
  const created = await admin.createConversation('pregunta');
  const response = await page.reload();
  expect(response?.headers()['cache-control']).toContain('no-store');
  await expect(page.locator(`a[href="/conversaciones/${created.id}"]`)).toBeVisible();
});
