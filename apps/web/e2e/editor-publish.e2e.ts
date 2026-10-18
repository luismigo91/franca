import type { Page } from '@playwright/test';
import { FLOWS } from '../tests/helpers/engine-events';
import { inspector, lastRequest, node, openEditor, screen } from './support/editor';
import { expect, test, text } from './support/test';

type Json = Record<string, unknown>;

const button = (page: Page, name: string) => screen(page).getByRole('button', { name, exact: true });

test('Publicar un flujo desde el editor', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await button(page, 'Publicar').click();
  await expect(screen(page).getByText('Publicada la versión 1.')).toBeVisible();
  expect(lastRequest(stack, 'POST', '/flows/captacion-leads/versions')?.headers['if-match']).toBe('"1"');
  await expect(screen(page).getByText('Versión 1', { exact: true })).toBeVisible();
  await expect(screen(page).getByText('Cambios sin publicar', { exact: true })).toHaveCount(0);
});

test('Publicar sin cambios desde el editor', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await button(page, 'Publicar').click();
  await expect(screen(page).getByText('La versión 1 ya tiene este borrador.')).toBeVisible();
  expect((await admin.versions('captacion-leads')).total).toBe(1);
});

test('Publicar tras mover un nodo', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await node(page, 'pedir-nombre').focus();
  await page.keyboard.press('ArrowRight');
  await button(page, 'Guardar').click();
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  await button(page, 'Publicar').click();
  await expect(screen(page).getByText('Publicada la versión 2.')).toBeVisible();
});

test('Publicar un borrador cambiado fuera', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await admin.updateDraft({ ...(FLOWS['captacion-leads'] as Json), name: 'Leads v2' });
  await button(page, 'Publicar').click();
  await expect(screen(page).getByText('El flujo ha cambiado fuera del editor.')).toBeVisible();
  await expect(button(page, 'Cargar el guardado')).toBeVisible();
  expect((await admin.versions('captacion-leads')).total).toBe(0);
});

test('Probar tras publicar', async ({ page, admin, stack }) => {
  await admin.publish('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await button(page, 'Probar').click();
  await page.waitForURL(/\/conversaciones\/[0-9a-f-]{36}$/);
  expect(lastRequest(stack, 'POST', '/conversations')?.body).toBe('{"flowId":"captacion-leads"}');
  await expect(text(page, '¡Hola! Te hago tres preguntas y te paso con la persona adecuada.')).toBeVisible();
});

test('Probar con cambios sin publicar', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  await admin.updateDraft({ ...(FLOWS['captacion-leads'] as Json), name: 'Leads v2' });
  await openEditor(page, 'captacion-leads');
  const probar = button(page, 'Probar');
  await probar.focus();
  await expect(probar).toBeFocused();
  await expect(probar).not.toHaveAttribute('aria-disabled', 'true');
  await expect(probar).toHaveAttribute('aria-describedby', 'try-note');
  await expect(screen(page).locator('#try-note')).toHaveText('Se probará la versión 1, no el borrador.');
});

test('Ver y copiar el JSON', async ({ page, admin, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await inspector(page).getByLabel('Nombre', { exact: true }).fill('Leads v2');
  await button(page, 'Ver JSON').click();
  const expected = JSON.stringify({ ...(FLOWS['captacion-leads'] as Json), name: 'Leads v2' });
  await expect(page.getByLabel('Texto JSON (solo lectura)')).toHaveValue(expected);
  await page.getByRole('button', { name: 'Copiar', exact: true }).click();
  await expect(screen(page).getByText('Copiado.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
});

test('Borrar un flujo desde el editor', async ({ page, admin, stack }) => {
  await admin.createDraft('hola');
  await openEditor(page, 'hola');
  await button(page, 'Borrar flujo').click();
  await expect(page.getByText(/queda reservado para siempre/).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.waitForURL(/\/flujos$/);
  expect(lastRequest(stack, 'DELETE', '/flows/hola')?.headers['if-match']).toBe('"1"');
  await expect(screen(page).getByText('Todavía no hay flujos', { exact: false })).toBeVisible();
  await expect(screen(page).getByText('Hola', { exact: true })).toHaveCount(0);
});

test('Borrar un flujo cambiado fuera', async ({ page, admin, stack }) => {
  await admin.createDraft('hola');
  await openEditor(page, 'hola');
  await admin.updateDraft({ ...(FLOWS.hola as Json), name: 'Hola 2' });
  await button(page, 'Borrar flujo').click();
  await page.getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(screen(page).getByText('El flujo ha cambiado fuera del editor.')).toBeVisible();
  await expect(button(page, 'Cargar el guardado')).toBeVisible();
  expect((await admin.flow('hola')).name).toBe('Hola 2');
  expect(lastRequest(stack, 'DELETE', '/flows/hola')?.headers['if-match']).toBe('"1"');
});
