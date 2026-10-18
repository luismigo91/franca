import { FLOWS } from '../tests/helpers/engine-events';
import { sendJson } from '../tests/helpers/fake-api';
import { inspector, node, openEditor, screen } from './support/editor';
import { expect, test, text } from './support/test';

type Json = Record<string, unknown>;

test('Abrir captacion-leads', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await expect(screen(page).getByRole('heading', { name: 'Captación de leads', level: 1 })).toBeVisible();
  await expect(screen(page).locator('code', { hasText: 'captacion-leads' })).toBeVisible();
  await expect(screen(page).getByText('Revisión 1')).toBeVisible();
  await expect(screen(page).getByText('Sin publicar', { exact: true })).toBeVisible();
  await expect(screen(page).locator('[data-node-id]')).toHaveCount(11);
  await expect(node(page, 'bienvenida')).toContainText('Inicio');
  await expect(screen(page).locator('[data-node-id]', { hasText: 'Inicio' })).toHaveCount(1);
});

test('Flujo cambiado fuera del editor', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await admin.updateDraft({ ...(FLOWS['captacion-leads'] as Json), name: 'Leads v2' });
  await page.reload();
  await expect(screen(page).getByRole('heading', { name: 'Leads v2', level: 1 })).toBeVisible();
  await expect(screen(page).getByText('Revisión 2')).toBeVisible();
});

test('Flujo que no existe en el editor', async ({ page, stack }) => {
  stack.fakeApi.respond((_request, response) => sendJson(response, 404, { message: 'flujo no encontrado', error: 'flow_not_found' }));
  for (const path of ['/flujos/no-existe', '/flujos/No%20Vale']) {
    await page.goto(path);
    await expect(text(page, 'Flujo no encontrado').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver a los flujos' })).toHaveAttribute('href', '/flujos');
  }
  expect(stack.fakeApi.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /flows/no-existe']);
});

test('API parada al abrir un flujo', async ({ page, admin, stack }) => {
  await admin.createDraft('hola');
  await stack.fakeApi.stop();
  await page.goto('/flujos/hola');
  await expect(text(page, 'No se puede conectar con la API de Franca.')).toBeVisible();
  await stack.fakeApi.start();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(node(page, 'fin')).toBeVisible();
});

test('El editor no carga direcciones del flujo', async ({ page, admin, external }) => {
  await admin.createDraft('medios');
  await openEditor(page, 'medios');
  await node(page, 'm').click();
  await expect(inspector(page)).toBeVisible();
  const area = inspector(page).locator('textarea').first();
  await expect(area).toHaveValue('<b>Hola</b>\nhttps://example.com');
  const values = await inspector(page).locator('input').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(values).toContain('https://example.com/logo.png');
  for (const tag of ['img', 'video', 'audio', 'iframe', 'embed', 'object', 'source', 'picture']) expect(await page.locator(`main:visible ${tag}`).count(), tag).toBe(0);
  expect(await page.locator('main:visible a[href*="example.com"]').count()).toBe(0);
  expect(external).toEqual([]);
});
