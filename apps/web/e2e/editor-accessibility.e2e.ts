import type { Page } from '@playwright/test';
import { inspector, node, openEditor, problems, screen } from './support/editor';
import { expect, test, text } from './support/test';

/** Lleva el foco a un elemento y pulsa Intro: el teclado, sin el ratón. */
async function activate(target: ReturnType<Page['locator']>, page: Page): Promise<void> {
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}

const focusedNode = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-node-id') ?? null);

test('Crear un flujo solo con teclado', async ({ page }) => {
  await page.goto('/flujos');
  await activate(page.getByRole('button', { name: 'Nuevo flujo', exact: true }), page);
  await page.getByLabel('Identificador').focus();
  await page.keyboard.type('teclado');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Teclado');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/flujos\/teclado$/);
  await page.locator('#editor-title').waitFor();
  await expect(page.getByRole('status').filter({ visible: true })).toHaveCount(1);

  await activate(screen(page).getByRole('button', { name: 'Añadir nodo' }), page);
  await activate(screen(page).getByRole('button', { name: 'Mensaje', exact: true }), page);
  await expect(node(page, 'message-1')).toBeFocused();
  // Los desplegables nativos no se manejan con teclas en Chromium sin cabeza: el destino se elige con `selectOption`.
  await inspector(page).getByLabel('Texto', { exact: true }).focus();
  await page.keyboard.type('Hola desde el teclado');
  await inspector(page).getByLabel('Siguiente (next)').selectOption('inicio');
  await activate(screen(page).getByRole('button', { name: 'Propiedades del flujo' }), page);
  await inspector(page).getByLabel('Nodo de inicio (start)').selectOption('message-1');
  await activate(screen(page).getByRole('button', { name: 'Guardar', exact: true }), page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  await activate(screen(page).getByRole('button', { name: 'Publicar', exact: true }), page);
  await expect(screen(page).getByText('Publicada la versión 1.')).toBeVisible();
  await activate(screen(page).getByRole('button', { name: 'Probar', exact: true }), page);
  await page.waitForURL(/\/conversaciones\//);
  await expect(text(page, 'Hola desde el teclado')).toBeVisible();
});

test('El foco tras añadir y borrar un nodo', async ({ page, admin }) => {
  await admin.createDraft('hola');
  await openEditor(page, 'hola');
  await activate(screen(page).getByRole('button', { name: 'Añadir nodo' }), page);
  await activate(screen(page).getByRole('button', { name: 'Mensaje', exact: true }), page);
  await expect.poll(() => focusedNode(page)).toBe('message-1');
  await activate(inspector(page).getByRole('button', { name: 'Borrar nodo message-1' }), page);
  await activate(page.getByRole('button', { name: 'Borrar', exact: true }), page);
  await expect(node(page, 'message-1')).toHaveCount(0);
  await expect(page.locator('#flow-canvas').filter({ visible: true })).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

test('Editor en pantalla estrecha', async ({ page, admin }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await node(page, 'enviar-crm').focus();
  await page.keyboard.press('Enter');
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  await inspector(page).scrollIntoViewIfNeeded();
  await expect(inspector(page).getByRole('heading', { name: /enviar-crm/ })).toBeVisible();
  await screen(page).getByRole('button', { name: 'Guardar', exact: true }).scrollIntoViewIfNeeded();
  await expect(screen(page).getByRole('button', { name: 'Guardar', exact: true })).toBeVisible();
  await problems(page).scrollIntoViewIfNeeded();
  await expect(problems(page).getByRole('heading', { name: 'Problemas' })).toBeVisible();
  const after = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(after.scroll).toBeLessThanOrEqual(after.client);
});
