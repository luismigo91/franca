import type { Page } from '@playwright/test';
import { bodyOf, countRequests, dragOutput, edges, fitCanvas, lastRequest, node, openEditor, problems, screen } from './support/editor';
import { expect, test } from './support/test';

type Json = Record<string, unknown>;

/** `left` y `top` con los que se pinta un nodo (en la capa del lienzo). */
async function placeOf(page: Page, id: string): Promise<[number, number]> {
  return node(page, id).evaluate((element) => [parseFloat((element as HTMLElement).style.left), parseFloat((element as HTMLElement).style.top)] as [number, number]);
}

async function allPlaces(page: Page, ids: string[]): Promise<Record<string, [number, number]>> {
  const out: Record<string, [number, number]> = {};
  for (const id of ids) out[id] = await placeOf(page, id);
  return out;
}

const FAQ_IDS = ['saludo', 'asistente', 'comprobar', 'pedir-email', 'crear-ticket', 'fin-resuelto', 'fin-escalado'];

/** El texto de «Ver JSON», con el diálogo cerrado después. */
async function viewJson(page: Page): Promise<string> {
  await screen(page).getByRole('button', { name: 'Ver JSON' }).click();
  const value = await page.getByLabel('Texto JSON (solo lectura)').inputValue();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  return value;
}

const nodeOf = (flow: Json, id: string) => (flow.nodes as Json[]).find((candidate) => candidate.id === id)!;

test('Abrir sin posiciones no cambia el flujo', async ({ page, admin, stack }) => {
  await admin.createDraft('faq-ia');
  await openEditor(page, 'faq-ia');
  const first = await allPlaces(page, FAQ_IDS);
  // Ningún nodo pinta más que su caja (nodeSize × zoom 1) ni se solapa con otro.
  const boxes: { id: string; x: number; y: number; width: number; height: number }[] = [];
  for (const id of FAQ_IDS) boxes.push({ id, ...(await node(page, id).boundingBox())! });
  for (const box of boxes) {
    expect(box.width).toBeLessThanOrEqual(208);
    expect(box.height).toBeLessThanOrEqual(64 + 24 * 3);
  }
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height, `${a.id}/${b.id}`).toBe(false);
  }
  await page.reload();
  await page.locator('#editor-title').waitFor();
  expect(await allPlaces(page, FAQ_IDS)).toEqual(first);
  await page.goto('/flujos');
  await page.goto('/flujos/faq-ia');
  await page.locator('#editor-title').waitFor();
  expect(await allPlaces(page, FAQ_IDS)).toEqual(first);
  await screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(screen(page).getByText('No hay cambios que guardar.')).toBeVisible();
  expect(countRequests(stack, 'PUT', '/flows/faq-ia')).toBe(0);
});

test('Mover un nodo guarda su posición', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  const before = await placeOf(page, 'pedir-nombre');
  await node(page, 'pedir-nombre').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const after = await placeOf(page, 'pedir-nombre');
  expect([after[0] - before[0], after[1] - before[1]]).toEqual([20, 0]);
  await screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  const flow = bodyOf(lastRequest(stack, 'PUT', '/flows/captacion-leads'));
  for (const each of flow.nodes as Json[]) {
    const { x, y } = each.position as { x: number; y: number };
    expect(Number.isInteger(x) && Number.isInteger(y), String(each.id)).toBe(true);
  }
  expect(nodeOf(flow, 'bienvenida').position).toEqual({ x: 0, y: 0 });
  expect(nodeOf(flow, 'pedir-nombre').position).toEqual({ x: 324, y: 0 });
  expect(((await admin.flow('captacion-leads')).flow.nodes as Json[])[1]!.position).toEqual({ x: 324, y: 0 });
});

test('Sustituir una conexión arrastrando', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await fitCanvas(page);
  await dragOutput(page, 'pedir-nombre', 'next', 'pedir-tamano');
  const found = await edges(page);
  expect(found.find((edge) => edge.from === 'pedir-nombre' && edge.key === 'next')?.to).toBe('pedir-tamano');
  expect(found.some((edge) => edge.from === 'pedir-nombre' && edge.to === 'pedir-email')).toBe(false);
  await expect(problems(page).getByRole('button', { name: 'pedir-email: nodo inalcanzable desde start' })).toBeVisible();
  expect(nodeOf(JSON.parse(await viewJson(page)) as Json, 'pedir-nombre').next).toBe('pedir-tamano');
});

test('Soltar una conexión en vacío', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await fitCanvas(page);
  await dragOutput(page, 'enviar-crm', 'onError', 'vacío');
  await dragOutput(page, 'enviar-crm', 'onError', 'escape', 'fin-pyme');
  await dragOutput(page, 'enviar-crm', 'onError', 'fuera');
  expect((await edges(page)).find((edge) => edge.from === 'enviar-crm' && edge.key === 'onError')?.to).toBe('aviso-error');
  await screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(screen(page).getByText('No hay cambios que guardar.')).toBeVisible();
  expect(countRequests(stack, 'PUT', '/flows/captacion-leads')).toBe(0);
});

test('El arrastre y el inspector dan el mismo flujo', async ({ page, admin, context }) => {
  await admin.createDraft('captacion-leads');
  const other = await context.newPage();
  await openEditor(page, 'captacion-leads');
  await openEditor(other, 'captacion-leads');
  await fitCanvas(page);
  await dragOutput(page, 'ruta-segmento', 'else', 'fin-empresa');
  // Solo con el teclado: el nodo se selecciona con Intro y el selector de la salida elige el destino (sin ratón; el desplegable
  // nativo no se maneja con teclas en Chromium sin cabeza, así que el destino se elige con `selectOption`).
  await node(other, 'ruta-segmento').focus();
  await other.keyboard.press('Enter');
  const select = other.getByLabel('Si no (else)');
  await select.focus();
  await select.selectOption('fin-empresa');
  await expect(select).toHaveValue('fin-empresa');
  const strip = (text: string) => {
    const flow = JSON.parse(text) as Json;
    for (const each of flow.nodes as Json[]) delete each.position;
    return JSON.stringify(flow);
  };
  expect(strip(await viewJson(other))).toBe(strip(await viewJson(page)));
  expect(JSON.parse(strip(await viewJson(page))).nodes.find((each: Json) => each.id === 'ruta-segmento').else).toBe('fin-empresa');
});

test('Conectar arrastrando no mueve los nodos', async ({ page, admin }) => {
  await admin.createDraft('faq-ia');
  await openEditor(page, 'faq-ia');
  await fitCanvas(page);
  const before = await allPlaces(page, FAQ_IDS);
  await dragOutput(page, 'crear-ticket', 'onError', 'fin-resuelto');
  expect(await allPlaces(page, FAQ_IDS)).toEqual(before);
  const flow = JSON.parse(await viewJson(page)) as Json;
  for (const each of flow.nodes as Json[]) {
    const { x, y } = each.position as { x: number; y: number };
    expect(Number.isInteger(x) && Number.isInteger(y), String(each.id)).toBe(true);
  }
  expect(nodeOf(flow, 'crear-ticket').onError).toBe('fin-resuelto');
});

test('Soltar sobre el propio nodo', async ({ page, admin, stack }) => {
  await admin.createDraft('faq-ia');
  await openEditor(page, 'faq-ia');
  await fitCanvas(page);
  await dragOutput(page, 'pedir-email', 'next', 'pedir-email');
  await expect(screen(page).getByRole('status')).toHaveText('Un nodo no puede saltar a sí mismo.');
  expect(nodeOf(JSON.parse(await viewJson(page)) as Json, 'pedir-email').next).toBe('crear-ticket');
  await dragOutput(page, 'asistente', 'onExhausted', 'asistente');
  await expect(screen(page).getByRole('status')).toHaveText('Un nodo no puede saltar a sí mismo.');
  expect(nodeOf(JSON.parse(await viewJson(page)) as Json, 'asistente').onExhausted).toBe('pedir-email');
  await expect(screen(page).getByText('Cambios sin guardar', { exact: true })).toHaveCount(0);
  expect(countRequests(stack, 'PUT', '/flows/faq-ia')).toBe(0);
});

test('Un llm que vuelve a sí mismo', async ({ page, admin }) => {
  await admin.createDraft('faq-ia');
  await openEditor(page, 'faq-ia');
  await fitCanvas(page);
  await dragOutput(page, 'asistente', 'next', 'asistente');
  expect(nodeOf(JSON.parse(await viewJson(page)) as Json, 'asistente').next).toBe('asistente');
  expect((await edges(page)).some((edge) => edge.from === 'asistente' && edge.key === 'next' && edge.to === 'asistente')).toBe(true);
  const list = problems(page).getByRole('listitem');
  await expect(list).toHaveText(['comprobar: nodo inalcanzable desde start', 'fin-resuelto: nodo inalcanzable desde start']);
});

test('cada clase de salida se conecta arrastrando', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await admin.createDraft('faq-ia');
  await openEditor(page, 'captacion-leads');
  await fitCanvas(page);
  await dragOutput(page, 'pedir-tamano', 'choices[pequena].next', 'marcar-empresa');
  await dragOutput(page, 'ruta-segmento', 'rules[0].next', 'fin-pyme');
  await screen(page).getByRole('button', { name: 'Añadir nodo' }).click();
  await screen(page).getByRole('button', { name: 'Salto', exact: true }).click();
  await expect(node(page, 'jump-1')).toBeVisible();
  await dragOutput(page, 'jump-1', 'target', 'bienvenida');
  const flow = JSON.parse(await viewJson(page)) as Json;
  expect(((nodeOf(flow, 'pedir-tamano').choices as Json[])[0] as Json).next).toBe('marcar-empresa');
  expect(((nodeOf(flow, 'ruta-segmento').rules as Json[])[0] as Json).next).toBe('fin-pyme');
  expect(nodeOf(flow, 'jump-1').target).toBe('bienvenida');
  await openEditor(page, 'faq-ia');
  await page.reload();
  await page.locator('#editor-title').waitFor();
  await fitCanvas(page);
  await dragOutput(page, 'asistente', 'onExhausted', 'fin-escalado');
  expect(nodeOf(JSON.parse(await viewJson(page)) as Json, 'asistente').onExhausted).toBe('fin-escalado');
});
