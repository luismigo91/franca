import type { Page } from '@playwright/test';
import { forwardThenCut, inspector, node, openEditor, screen, countRequests, lastRequest } from './support/editor';
import { expect, test } from './support/test';


const save = (page: Page) => screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
const nameField = (page: Page) => inspector(page).getByLabel('Nombre', { exact: true });
const puts = (stack: Parameters<typeof countRequests>[0]) => stack.fakeApi.requests.filter((request) => request.method === 'PUT');

async function select(page: Page, id: string): Promise<void> {
  await node(page, id).focus();
  await page.keyboard.press('Enter');
  await expect(node(page, id)).toHaveAttribute('aria-pressed', 'true');
}

test('Validar no llama a la API', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  stack.fakeApi.reset();
  stack.fakeApi.forwardTo(Number(new URL(stack.realApiUrl).port));
  await openEditor(page, 'captacion-leads');
  await nameField(page).fill('Cambio 1');
  await inspector(page).getByLabel('Descripción', { exact: true }).fill('Cambio 2');
  await inspector(page).getByLabel('Idioma (locale)').fill('en');
  await inspector(page).getByLabel('Retardo de escritura (ms)').fill('100');
  await inspector(page).getByLabel('Caducidad de la sesión (min)').fill('30');
  await select(page, 'bienvenida');
  await inspector(page).getByLabel('Título').fill('Cambio 6');
  await select(page, 'pedir-nombre');
  await inspector(page).getByLabel('Título').fill('Cambio 7');
  await select(page, 'pedir-email');
  await inspector(page).getByLabel('Texto de ayuda').fill('Cambio 8');
  await inspector(page).getByLabel('Reintentos máximos').fill('3');
  await select(page, 'enviar-crm');
  await inspector(page).getByLabel('Plazo (ms)').fill('abc');
  await screen(page).getByRole('button', { name: 'Propiedades del flujo' }).click();
  await nameField(page).fill('Captación de leads');
  expect(stack.fakeApi.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /flows/captacion-leads']);
});

test('Guardar un cambio', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await nameField(page).fill('Leads v2');
  await save(page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  await expect(screen(page).getByText('Revisión 2', { exact: true })).toBeVisible();
  const request = lastRequest(stack, 'PUT', '/flows/captacion-leads')!;
  expect(request.headers['if-match']).toBe('"1"');
  expect((await admin.flow('captacion-leads')).name).toBe('Leads v2');
  await expect(screen(page).getByText('Cambios sin guardar', { exact: true })).toHaveCount(0);
});

test('No se guarda un flujo inválido', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'pedir-nombre');
  await inspector(page).getByLabel('Siguiente (next)').selectOption('');
  await save(page);
  await expect(screen(page).getByText('Corrige los problemas antes de guardar.')).toBeVisible();
  await expect(page.locator('#problems-title')).toBeFocused();
  expect(countRequests(stack, 'PUT', '/flows/captacion-leads')).toBe(0);
});

async function twoTabs(page: Page, admin: { createDraft: (flow: 'captacion-leads') => Promise<void> }, context: import('@playwright/test').BrowserContext) {
  await admin.createDraft('captacion-leads');
  const second = await context.newPage();
  await openEditor(page, 'captacion-leads');
  await openEditor(second, 'captacion-leads');
  await nameField(page).fill('A');
  await save(page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  await nameField(second).fill('B');
  await save(second);
  await expect(screen(second).getByText('El flujo ha cambiado en otra pestaña o fuera del editor.')).toBeVisible();
  return second;
}

test('Dos pestañas editan el mismo flujo', async ({ page, admin, stack, context }) => {
  const second = await twoTabs(page, admin, context);
  await screen(second).getByRole('button', { name: 'Guardar encima' }).click();
  await expect(screen(second).getByText('Guardado. Revisión 3.')).toBeVisible();
  expect(puts(stack).map((request) => request.headers['if-match'])).toEqual(['"1"', '"1"', '"2"']);
  const real = await admin.flow('captacion-leads');
  expect([real.revision, real.name]).toEqual([3, 'B']);
});

test('Cargar el guardado tras un conflicto', async ({ page, admin, context }) => {
  const second = await twoTabs(page, admin, context);
  await screen(second).getByRole('button', { name: 'Cargar el guardado' }).click();
  await expect(screen(second).getByRole('heading', { name: 'A', level: 1 })).toBeVisible();
  await expect(screen(second).getByText('Revisión 2', { exact: true })).toBeVisible();
  await expect(screen(second).getByText('Cambios sin guardar', { exact: true })).toHaveCount(0);
});

test('Guardado con respuesta perdida', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  forwardThenCut(stack);
  await nameField(page).fill('Leads v2');
  await save(page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  expect(puts(stack)).toHaveLength(1);
  expect(stack.fakeApi.requests.some((request) => request.method === 'GET' && request.path === '/flows/captacion-leads')).toBe(true);
  const real = await admin.flow('captacion-leads');
  expect([real.revision, real.name]).toEqual([2, 'Leads v2']);
});

test('Flujo borrado mientras se edita', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await nameField(page).fill('Leads v2');
  await admin.deleteFlow('captacion-leads');
  await save(page);
  await expect(screen(page).getByText('El flujo se ha borrado fuera del editor. Usa «Ver JSON» para copiar lo que has editado.')).toBeVisible();
  await expect(nameField(page)).toHaveValue('Leads v2');
  await screen(page).getByRole('button', { name: 'Ver JSON' }).click();
  expect(JSON.parse(await page.getByLabel('Texto JSON (solo lectura)').inputValue()).name).toBe('Leads v2');
});

test('Descartar cambios', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'aviso-error');
  await inspector(page).getByRole('button', { name: 'Borrar nodo aviso-error' }).click();
  await page.getByRole('button', { name: 'Borrar', exact: true }).click();
  await screen(page).getByRole('button', { name: 'Propiedades del flujo' }).or(inspector(page).getByLabel('Nombre', { exact: true })).first().waitFor();
  await nameField(page).fill('Otro');
  await expect(screen(page).locator('[data-node-id]')).toHaveCount(10);
  await screen(page).getByRole('button', { name: 'Descartar cambios' }).click();
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(screen(page).getByRole('heading', { name: 'Captación de leads', level: 1 })).toBeVisible();
  await expect(screen(page).locator('[data-node-id]')).toHaveCount(11);
  await expect(screen(page).getByText('Cambios sin guardar', { exact: true })).toHaveCount(0);
  await expect(page.locator('#editor-title')).toBeFocused();
});

test('Salir con cambios sin guardar', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await nameField(page).fill('Otro');
  const link = screen(page).getByRole('navigation').getByRole('link', { name: 'Flujos', exact: true });
  await link.click();
  await expect(page.getByText('Hay cambios sin guardar. Si sales, se pierden.').filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(page).toHaveURL(/\/flujos\/captacion-leads$/);
  await expect(nameField(page)).toHaveValue('Otro');
  await link.click();
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(page).toHaveURL(/\/flujos$/);
  await screen(page).getByRole('link', { name: 'Captación de leads' }).click();
  await page.locator('#editor-title').waitFor();
  await expect(screen(page).getByRole('heading', { name: 'Captación de leads', level: 1 })).toBeVisible();
  await expect(screen(page).getByText('Cambios sin guardar', { exact: true })).toHaveCount(0);
  await expect(nameField(page)).toHaveValue('Captación de leads');
});

test('Recargar con cambios', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await nameField(page).fill('Otro');
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  await page.reload();
  await page.locator('#editor-title').waitFor();
  expect(dialogs).toEqual(['beforeunload']);
  // Recargado, el editor leyó el borrador: sin cambios, recargar otra vez no pregunta.
  await expect(nameField(page)).toHaveValue('Captación de leads');
  await page.reload();
  await page.locator('#editor-title').waitFor();
  expect(dialogs).toEqual(['beforeunload']);
});
