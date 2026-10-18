import type { Page } from '@playwright/test';
import { inspector, node, openEditor, screen } from './support/editor';
import { expect, test } from './support/test';

type Json = Record<string, unknown>;

const focused = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? null);

async function viewJson(page: Page): Promise<Json> {
  await screen(page).getByRole('button', { name: 'Ver JSON' }).click();
  const value = await page.getByLabel('Texto JSON (solo lectura)').inputValue();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  return JSON.parse(value) as Json;
}

const nodeOf = (flow: Json, id: string) => (flow.nodes as Json[]).find((candidate) => candidate.id === id)!;
const base = (id: string, nodes: Json[], extra: Json = {}): Json => ({ specVersion: '0.1', id, name: id, start: nodes[0]!.id, nodes, ...extra });

async function select(page: Page, id: string): Promise<void> {
  await node(page, id).click();
  await expect(node(page, id)).toHaveAttribute('aria-pressed', 'true');
}

test('JsonField: quitar la primera de dos reglas no reescribe el predicado de la borrada', async ({ page, admin }) => {
  const when = (name: 'all' | 'any', value: string) => ({ [name]: [{ variable: 'a', op: 'eq', value }] });
  await admin.createDraft(
    base('reglas', [{ id: 'c', type: 'condition', rules: [{ when: when('all', '1'), next: 'f' }, { when: when('any', '2'), next: 'f' }], else: 'f' }, { id: 'f', type: 'end' }], { variables: [{ name: 'a', type: 'string' }] }),
  );
  await openEditor(page, 'reglas');
  await select(page, 'c');
  const area = inspector(page).getByLabel('Condición (JSON)');
  await expect(area).toHaveCount(2);
  await area.first().fill(JSON.stringify(when('all', '9')));
  await inspector(page).getByRole('button', { name: 'Quitar regla 1' }).click();
  await expect(inspector(page).getByLabel('Condición (JSON)')).toHaveCount(1);
  await expect(inspector(page).getByLabel('Condición (JSON)')).toHaveValue(JSON.stringify(when('any', '2'), null, 2));
  await inspector(page).getByLabel('Condición (JSON)').press('End');
  await page.keyboard.type(' ');
  const rules = nodeOf(await viewJson(page), 'c').rules as Json[];
  expect(rules).toHaveLength(1);
  expect(rules[0]!.when).toEqual(when('any', '2'));
});

test('JsonField: «Editar como JSON» que cambia request.body se ve en el inspector y no se deshace al teclear', async ({ page, admin }) => {
  await admin.createDraft(base('cuerpo', [{ id: 'h', type: 'http', request: { method: 'POST', url: 'https://x.example/a', body: { a: 1 } }, next: 'f', onError: 'f' }, { id: 'f', type: 'end' }]));
  await openEditor(page, 'cuerpo');
  await select(page, 'h');
  await expect(inspector(page).getByLabel('Cuerpo (JSON)')).toHaveValue('{\n  "a": 1\n}');
  await inspector(page).getByLabel('Cuerpo (JSON)').fill('{"a":2}');
  await inspector(page).getByRole('button', { name: 'Editar como JSON' }).click();
  const area = page.getByLabel('JSON del nodo');
  const current = JSON.parse(await area.inputValue()) as Json;
  (current.request as Json).body = { z: 9 };
  await area.fill(JSON.stringify(current));
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(inspector(page).getByLabel('Cuerpo (JSON)')).toHaveValue('{\n  "z": 9\n}');
  await inspector(page).getByLabel('Cuerpo (JSON)').press('End');
  await page.keyboard.type(' ');
  expect(((nodeOf(await viewJson(page), 'h').request as Json).body)).toEqual({ z: 9 });
});

test('ValueField: el modo elegido no se arrastra al elemento que ocupa el sitio', async ({ page, admin }) => {
  await admin.createDraft(
    base('valores', [{ id: 's', type: 'set', assignments: [{ variable: 'a', value: 'x' }, { variable: 'b', value: 'y' }], next: 'f' }, { id: 'f', type: 'end' }], {
      variables: [{ name: 'a', type: 'string' }, { name: 'b', type: 'string' }],
    }),
  );
  await openEditor(page, 'valores');
  await select(page, 's');
  const first = inspector(page).getByRole('group', { name: 'asignación 1' });
  await first.getByLabel('Valor: tipo de valor').selectOption('boolean');
  await expect(first.getByLabel('Valor: tipo de valor')).toHaveValue('boolean');
  await inspector(page).getByRole('button', { name: 'Quitar asignación 1' }).click();
  await expect(inspector(page).getByLabel('Valor: tipo de valor')).toHaveValue('string');
  await expect(inspector(page).getByLabel('Valor: valor')).toHaveValue('y');
});

test('El foco no cae a la página al renombrar un nodo (Intro o Tab)', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'pedir-nombre');
  const field = inspector(page).getByLabel('Identificador');
  await field.fill('nombre-nuevo');
  await field.press('Enter');
  await expect(node(page, 'nombre-nuevo')).toBeVisible();
  expect(await focused(page)).not.toBe('BODY');
  await inspector(page).getByLabel('Identificador').fill('nombre-dos');
  await page.keyboard.press('Tab');
  await expect(node(page, 'nombre-dos')).toBeVisible();
  expect(await focused(page)).not.toBe('BODY');
});

test('El foco no cae a la página al renombrar una cabecera', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'enviar-crm');
  const row = inspector(page).getByRole('group', { name: 'Cabecera Content-Type' });
  await row.getByLabel('Nombre', { exact: true }).fill('X-Tipo');
  await row.getByLabel('Nombre', { exact: true }).press('Enter');
  await expect(inspector(page).getByRole('group', { name: 'Cabecera X-Tipo' })).toBeVisible();
  expect(await focused(page)).not.toBe('BODY');
  await inspector(page).getByRole('group', { name: 'Cabecera X-Tipo' }).getByLabel('Nombre', { exact: true }).fill('X-Otro');
  await page.keyboard.press('Tab');
  await expect(inspector(page).getByRole('group', { name: 'Cabecera X-Otro' })).toBeVisible();
  expect(await focused(page)).not.toBe('BODY');
});

test('El foco no cae a la página al aplicar «Editar como JSON» con otro id', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'bienvenida');
  await inspector(page).getByRole('button', { name: 'Editar como JSON' }).click();
  const area = page.getByLabel('JSON del nodo');
  const current = JSON.parse(await area.inputValue()) as Json;
  await area.fill(JSON.stringify({ ...current, id: 'saludo' }));
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(node(page, 'saludo')).toBeVisible();
  await expect.poll(() => focused(page)).not.toBe('BODY');
});

test('El foco no cae a la página tras quitar un elemento de una lista o de un contenido', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await select(page, 'pedir-tamano');
  await inspector(page).getByRole('button', { name: 'Quitar opción 3' }).click();
  expect(await focused(page)).not.toBe('BODY');
  await select(page, 'bienvenida');
  await inspector(page).getByRole('button', { name: /^Quitar contenido 1/ }).click();
  expect(await focused(page)).not.toBe('BODY');
});
