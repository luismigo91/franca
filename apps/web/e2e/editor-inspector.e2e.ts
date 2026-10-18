import type { Page } from '@playwright/test';
import { FLOWS } from '../tests/helpers/engine-events';
import { bodyOf, countRequests, edges, inspector, lastRequest, node, openEditor, problems, screen } from './support/editor';
import { expect, test } from './support/test';

type Json = Record<string, unknown>;

async function viewJson(page: Page): Promise<string> {
  await screen(page).getByRole('button', { name: 'Ver JSON' }).click();
  const value = await page.getByLabel('Texto JSON (solo lectura)').inputValue();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  return value;
}

const nodeOf = (flow: Json, id: string) => (flow.nodes as Json[]).find((candidate) => candidate.id === id)!;
const save = (page: Page) => screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();

/** Selecciona un nodo con el teclado: foco y Intro. */
async function select(page: Page, id: string): Promise<void> {
  await node(page, id).focus();
  await page.keyboard.press('Enter');
  await expect(node(page, id)).toHaveAttribute('aria-pressed', 'true');
}

test('Conectar desde el inspector no mueve los nodos', async ({ page, admin }) => {
  await admin.createDraft('faq-ia');
  await openEditor(page, 'faq-ia');
  const ids = ['saludo', 'asistente', 'comprobar', 'pedir-email', 'crear-ticket', 'fin-resuelto', 'fin-escalado'];
  const places = async () => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await node(page, id).evaluate((element) => [(element as HTMLElement).style.left, (element as HTMLElement).style.top])])));
  const before = await places();
  await select(page, 'crear-ticket');
  await inspector(page).getByLabel('Si falla (onError)').selectOption('fin-resuelto');
  expect(await places()).toEqual(before);
  const flow = JSON.parse(await viewJson(page)) as Json;
  for (const each of flow.nodes as Json[]) {
    const { x, y } = each.position as { x: number; y: number };
    expect(Number.isInteger(x) && Number.isInteger(y), String(each.id)).toBe(true);
  }
  expect(nodeOf(flow, 'crear-ticket').onError).toBe('fin-resuelto');
});

test('Declarar una variable personal', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await screen(page).getByRole('button', { name: 'Añadir variable' }).click();
  const added = inspector(page).getByRole('group', { name: 'variable 5' });
  await added.getByLabel('Nombre de la variable').fill('ciudad');
  await added.getByLabel('Dato personal').check();
  await save(page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  const variables = bodyOf(lastRequest(stack, 'PUT', '/flows/captacion-leads')).variables as Json[];
  expect(JSON.stringify(variables.at(-1))).toBe('{"name":"ciudad","type":"string","pii":true}');
});

test('Los ocho tipos en el inspector', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await admin.createDraft('faq-ia');
  await openEditor(page, 'captacion-leads');
  await select(page, 'bienvenida');
  await expect(inspector(page).getByRole('heading', { name: /Mensaje/ })).toBeVisible();
  await expect(inspector(page).getByLabel('Siguiente (next)')).toHaveValue('pedir-nombre');
  await select(page, 'pedir-nombre');
  await expect(inspector(page).getByLabel('Variable', { exact: true })).toHaveValue('nombre');
  await select(page, 'pedir-tamano');
  await expect(inspector(page).getByRole('button', { name: /^Quitar opción/ })).toHaveCount(3);
  await select(page, 'ruta-segmento');
  await expect(inspector(page).getByRole('group', { name: 'regla 1' })).toBeVisible();
  await select(page, 'marcar-pyme');
  await expect(inspector(page).getByRole('group', { name: 'asignación 1' })).toBeVisible();
  await select(page, 'enviar-crm');
  await expect(inspector(page).getByLabel('Método')).toHaveValue('POST');
  await select(page, 'fin-empresa');
  await expect(inspector(page).getByLabel('Resultado (outcome)')).toHaveValue('lead-empresa');
  await screen(page).getByRole('button', { name: 'Añadir nodo' }).click();
  await screen(page).getByRole('button', { name: 'Salto', exact: true }).click();
  await expect(inspector(page).getByLabel('Destino (target)')).toHaveValue('');
  await openEditor(page, 'faq-ia');
  await select(page, 'asistente');
  await expect(inspector(page).getByLabel('Proveedor (nombre)')).toHaveValue('principal');
  await expect(inspector(page).getByLabel('Si se agota (onExhausted)')).toHaveValue('pedir-email');
});

test('Regla de una condición', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'ruta-segmento');
  await inspector(page).getByLabel('Valor: valor').fill('pyme');
  await save(page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  const rules = nodeOf(bodyOf(lastRequest(stack, 'PUT', '/flows/captacion-leads')), 'ruta-segmento').rules as Json[];
  expect(JSON.stringify(rules[0]!.when)).toBe('{"variable":"segmento","op":"eq","value":"pyme"}');
});

test('Número escrito con letras', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'enviar-crm');
  await inspector(page).getByLabel('Plazo (ms)').fill('abc');
  await expect(problems(page).getByRole('button', { name: 'enviar-crm: debe ser de tipo integer' })).toBeVisible();
  await expect(inspector(page).getByLabel('Plazo (ms)')).toHaveValue('abc');
});

test('Cabecera con un secreto', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'enviar-crm');
  const form = inspector(page).getByRole('group', { name: 'Nueva cabecera' });
  await form.getByLabel('Nombre de la cabecera').fill('X-Api-Key');
  await form.getByLabel('Tipo de la cabecera').selectOption('secret');
  await form.getByLabel('Nombre del secreto, en mayúsculas').fill('SOPORTE_TOKEN');
  await form.getByRole('button', { name: 'Añadir cabecera' }).click();
  await save(page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  const headers = JSON.stringify(((nodeOf(bodyOf(lastRequest(stack, 'PUT', '/flows/captacion-leads')), 'enviar-crm').request as Json).headers) as Json);
  expect(headers.endsWith('"X-Api-Key":{"secret":"SOPORTE_TOKEN"}}')).toBe(true);
});

test('Token pegado en una cabecera', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'enviar-crm');
  const row = inspector(page).getByRole('group', { name: 'Cabecera Authorization' });
  await row.getByLabel('Tipo', { exact: true }).selectOption('text');
  await row.getByLabel('Valor', { exact: true }).fill('Bearer abc123');
  await expect(row.getByText(/lleva el valor escrito en el flujo/)).toBeVisible();
  await save(page);
  await expect(screen(page).getByText('Hay una credencial escrita en una cabecera: usa un secreto.')).toBeVisible();
  expect(countRequests(stack, 'PUT', '/flows/captacion-leads')).toBe(0);
});

test('Añadir un mensaje', async ({ page, admin }) => {
  await admin.createDraft('hola');
  await openEditor(page, 'hola');
  await screen(page).getByRole('button', { name: 'Añadir nodo' }).click();
  await screen(page).getByRole('button', { name: 'Mensaje', exact: true }).click();
  await expect(node(page, 'message-1')).toBeVisible();
  await expect(node(page, 'message-1')).toBeFocused();
  await expect(node(page, 'message-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(problems(page).getByRole('button', { name: "message-1: falta la propiedad obligatoria 'next'" })).toBeVisible();
  const flow = JSON.parse(await viewJson(page)) as Json;
  const last = (flow.nodes as Json[]).at(-1)!;
  expect(Object.keys(last)).toEqual(['id', 'type', 'position', 'content']);
  expect(JSON.stringify({ ...last, position: 0 })).toBe('{"id":"message-1","type":"message","position":0,"content":[{"kind":"text","text":""}]}');
  const { x, y } = last.position as { x: number; y: number };
  expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
  expect(nodeOf(flow, 'fin').position).toBeDefined();
});

test('Renombrar al id de otro nodo', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'pedir-nombre');
  await inspector(page).getByLabel('Identificador').fill('pedir-email');
  await expect(inspector(page).getByText('Ese id ya lo tiene otro nodo.')).toBeVisible();
  await inspector(page).getByLabel('Identificador').press('Enter');
  await expect(node(page, 'pedir-nombre')).toBeVisible();
  await expect(screen(page).getByText('Cambios sin guardar', { exact: true })).toHaveCount(0);
});

test('Borrar un nodo con saltos hacia él', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'aviso-error');
  await inspector(page).getByRole('button', { name: 'Borrar nodo aviso-error' }).click();
  await page.getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(screen(page).locator('[data-node-id]')).toHaveCount(10);
  const broken = (await edges(page)).filter((edge) => edge.broken);
  expect(broken.map((edge) => `${edge.from}.${edge.key}->${edge.to}`)).toEqual(['enviar-crm.onError->aviso-error']);
  await expect(problems(page).getByRole('button', { name: 'enviar-crm: onError apunta a un nodo inexistente: aviso-error' })).toBeVisible();
});

test('Aplicar el JSON de un nodo', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'bienvenida');
  await inspector(page).getByRole('button', { name: 'Editar como JSON' }).click();
  const area = page.getByLabel('JSON del nodo');
  const current = JSON.parse(await area.inputValue()) as Json;
  await area.fill(JSON.stringify({ ...current, title: 'Saludo' }, null, 2));
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(node(page, 'bienvenida')).toContainText('Saludo');
  const expected = structuredClone(FLOWS['captacion-leads']) as Json;
  (nodeOf(expected, 'bienvenida') as Json).title = 'Saludo';
  expect(await viewJson(page)).toBe(JSON.stringify(expected));
});

test('Error al dejar un nodo sin conectar', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'pedir-nombre');
  await inspector(page).getByLabel('Siguiente (next)').selectOption('');
  await expect(problems(page).getByRole('button', { name: "pedir-nombre: falta la propiedad obligatoria 'next'" })).toBeVisible({ timeout: 1000 });
  await expect(node(page, 'pedir-nombre')).toContainText('1 problema');
  await expect(problems(page)).toContainText('Hay problemas de forma: el resto de comprobaciones llegará al corregirlos.');
});

test('Del problema al nodo', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'pedir-nombre');
  await inspector(page).getByLabel('Siguiente (next)').selectOption('');
  await select(page, 'bienvenida');
  await problems(page).getByRole('button', { name: "pedir-nombre: falta la propiedad obligatoria 'next'" }).click();
  await expect(node(page, 'pedir-nombre')).toHaveAttribute('aria-pressed', 'true');
  await expect(node(page, 'pedir-nombre')).toBeInViewport();
  await expect(page.locator('#inspector-title')).toBeFocused();
  await expect(page.locator('#inspector-title')).toContainText('pedir-nombre');
});

test('añadir una condición no rompe el lienzo', async ({ page, admin }) => {
  await admin.createDraft('hola');
  await openEditor(page, 'hola');
  await screen(page).getByRole('button', { name: 'Añadir nodo' }).click();
  await screen(page).getByRole('button', { name: 'Condición', exact: true }).click();
  await expect(node(page, 'condition-1')).toBeVisible();
  await expect(node(page, 'condition-1').locator('[data-output="else"]')).toBeVisible();
  await expect(problems(page).getByRole('button', { name: "condition-1: falta la propiedad obligatoria 'rules'" })).toBeVisible();
});
