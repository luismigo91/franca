import { FLOWS } from '../tests/helpers/engine-events';
import { countRequests, lastRequest, screen } from './support/editor';
import { expect, test, text } from './support/test';

type Json = Record<string, unknown>;

const CAPTACION_TEXT = JSON.stringify(FLOWS['captacion-leads']);
const items = (page: import('@playwright/test').Page) => screen(page).locator('li');

test('Del editor al chat', async ({ page }) => {
  await page.goto('/flujos');
  await expect(page).toHaveTitle(/Franca/);
  const title = await page.title();
  expect(title).not.toContain('@franca/');
  expect(title).not.toContain('franca-web');
  const body = await page.locator('body').innerText();
  for (const forbidden of ['@franca/', 'franca-web']) expect(body).not.toContain(forbidden);
  await page.getByRole('link', { name: 'Chat de prueba' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('Borradores y publicados en la lista', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  const changed = structuredClone(FLOWS['captacion-leads']) as Json;
  changed.name = 'Captación de leads';
  (changed.nodes as Json[])[0]!.content = [{ kind: 'text', text: 'Hola, borrador sin publicar.' }];
  await admin.updateDraft(changed);
  await admin.createDraft('hola');
  await page.goto('/flujos');
  await expect(items(page)).toHaveCount(2);
  await expect(items(page).nth(0)).toContainText('Hola');
  await expect(items(page).nth(0)).toContainText('Sin publicar');
  await expect(items(page).nth(1)).toContainText('Captación de leads');
  await expect(items(page).nth(1)).toContainText('Versión 1');
  await expect(items(page).nth(1)).toContainText('Cambios sin publicar');
  await items(page).nth(0).getByRole('link', { name: 'Hola' }).click();
  await expect(page).toHaveURL(/\/flujos\/hola$/);
});

test('Más de una página en el editor', async ({ page, admin }) => {
  for (let index = 1; index <= 21; index++) await admin.createDraft({ ...(FLOWS.hola as Json), id: `hola-${String(index).padStart(2, '0')}`, name: `Hola ${index}` });
  await page.goto('/flujos');
  await expect(items(page)).toHaveCount(20);
  await page.getByRole('button', { name: 'Ver más flujos' }).click();
  await expect(items(page)).toHaveCount(21);
  const names = await screen(page).locator('li a').allInnerTexts();
  expect(new Set(names).size).toBe(21);
  await expect(page.getByRole('button', { name: 'Ver más flujos' })).toHaveCount(0);
});

test('Sin flujos en el editor', async ({ page }) => {
  await page.goto('/flujos');
  await expect(text(page, /Todavía no hay flujos/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo flujo', exact: true })).toBeVisible();
});

test('API parada en el editor', async ({ page, admin, stack }) => {
  await admin.createDraft('hola');
  await stack.fakeApi.stop();
  await page.goto('/flujos');
  await expect(text(page, 'No se puede conectar con la API de Franca.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await stack.fakeApi.start();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(items(page)).toHaveCount(1);
  await expect(items(page).first()).toContainText('Hola');
});

test('Crear un flujo vacío', async ({ page, stack }) => {
  await page.goto('/flujos');
  await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
  await page.getByLabel('Identificador').fill('bienvenida-web');
  await page.getByLabel('Nombre').fill('Bienvenida');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.waitForURL(/\/flujos\/bienvenida-web$/);
  expect(lastRequest(stack, 'POST', '/flows')?.body).toBe('{"specVersion":"0.1","id":"bienvenida-web","name":"Bienvenida","start":"inicio","nodes":[{"id":"inicio","type":"end"}]}');
  await expect(screen(page).locator('[data-node-id]')).toHaveCount(1);
  await expect(screen(page).locator('[data-node-id="inicio"]')).toContainText('Inicio');
});

test('Identificador no admitido', async ({ page, stack }) => {
  await page.goto('/flujos');
  await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
  await page.getByLabel('Identificador').fill('Mi Flujo');
  await page.getByLabel('Nombre').fill('Mío');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  const field = page.getByLabel('Identificador');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();
  await expect(page.getByText(/El identificador empieza por una letra minúscula/)).toBeVisible();
  expect(countRequests(stack, 'POST', '/flows')).toBe(0);
});

test('Importar un ejemplo', async ({ page, stack }) => {
  await page.goto('/flujos');
  await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
  await page.getByLabel('Desde JSON').check();
  await page.getByLabel('JSON del flujo').fill(JSON.stringify(FLOWS['captacion-leads'], null, 2));
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.waitForURL(/\/flujos\/captacion-leads$/);
  expect(lastRequest(stack, 'POST', '/flows')?.body).toBe(CAPTACION_TEXT);
  await expect(screen(page).locator('[data-node-id]')).toHaveCount(11);
  await expect(screen(page).locator('[data-edge-from]')).toHaveCount(12);
});

test('JSON pegado que no es un flujo válido', async ({ page, stack }) => {
  await page.goto('/flujos');
  await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
  await page.getByLabel('Desde JSON').check();
  await page.getByLabel('JSON del flujo').fill('{"id":');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByText('El texto no es JSON.')).toBeVisible();
  await page.getByLabel('JSON del flujo').fill('{"id": "x"}');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByText('El flujo no es válido:')).toBeVisible();
  for (const property of ['specVersion', 'name', 'start', 'nodes']) await expect(page.getByText(`falta la propiedad obligatoria '${property}'`)).toBeVisible();
  await expect(page.locator('dialog[open] li')).toHaveCount(4);
  expect(countRequests(stack, 'POST', '/flows')).toBe(0);
});

test('Id repetido en el editor', async ({ page, admin }) => {
  await admin.createDraft('hola');
  await page.goto('/flujos');
  await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
  await page.getByLabel('Identificador').fill('hola');
  await page.getByLabel('Nombre').fill('Otro');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByText('Ya existe un flujo con ese identificador.')).toBeVisible();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await expect(page.getByLabel('Nombre')).toHaveValue('Otro');
  expect((await admin.flow('hola')).name).toBe('Hola');
});

test('Id reservado en el editor', async ({ page, admin }) => {
  await admin.createDraft('hola');
  await admin.deleteFlow('hola');
  await page.goto('/flujos');
  await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
  await page.getByLabel('Identificador').fill('hola');
  await page.getByLabel('Nombre').fill('Otra vez');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByText('Ese identificador perteneció a un flujo borrado y no se puede reutilizar.')).toBeVisible();
});
