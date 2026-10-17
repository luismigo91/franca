import { CONVERSATION_ID, flowItem, messageEvent, resourceOf, scripted } from './support/api-shapes';
import { answer, answerBox, expect, test, text, tryFlow } from './support/test';

test('Reabrir una conversación', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  await tryFlow(page, 'Captación de leads');
  await text(page, '¿Cómo te llamas?').waitFor();
  await answer(page, ' Ana ');
  await text(page, '¿A qué email te escribimos?').waitFor();
  await answer(page, 'ana@');
  await text(page, 'Ese email no parece válido, ¿lo revisas?').waitFor();
  await page.reload();
  await text(page, 'Ese email no parece válido, ¿lo revisas?').waitFor();
  const log = page.getByRole('log');
  await expect(log).toContainText('¡Hola! Te hago tres preguntas y te paso con la persona adecuada.');
  const rendered = (await log.innerText()).replace(/\s+/g, ' ');
  const order = ['¡Hola! Te hago tres preguntas', '¿Cómo te llamas?', 'Ana', 'Encantado, Ana', 'ana@', 'Ese email no parece válido'];
  let at = -1;
  for (const piece of order) {
    const found = rendered.indexOf(piece, at + 1);
    expect(found, piece).toBeGreaterThan(at);
    at = found;
  }
  await expect(page.getByText('Escribiendo…')).toHaveCount(0);
  await expect(answerBox(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Captación de leads');
  await expect(page.getByText('Versión 1').first()).toBeVisible();
  // El texto de ` Ana ` se pinta con sus espacios.
  expect(await log.locator('p', { hasText: 'Ana' }).filter({ hasNotText: 'Encantado' }).first().textContent()).toBe(' Ana ');
});

test('Transcripción de varias páginas', async ({ page, stack }) => {
  const items = Array.from({ length: 150 }, (_, index) => flowItem(index + 1, messageEvent('n', `Mensaje ${index + 1}`)));
  const world = { conversation: resourceOf({ id: CONVERSATION_ID }), items };
  stack.fakeApi.respond(scripted(world, () => undefined));
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, 'Mensaje 150').waitFor();
  const paths = stack.fakeApi.requests.map((request) => request.path).filter((path) => path.includes('/transcript'));
  expect(paths).toContain(`/conversations/${CONVERSATION_ID}/transcript?limit=100&offset=0`);
  expect(paths).toContain(`/conversations/${CONVERSATION_ID}/transcript?limit=100&offset=100`);
  const messages = await page.getByRole('log').locator('p.whitespace-pre-wrap').allInnerTexts();
  expect(messages).toEqual(items.map((_, index) => `Mensaje ${index + 1}`));
});

test('Conversación que no existe', async ({ page, stack }) => {
  await page.goto('/conversaciones/00000000-0000-4000-8000-000000000000');
  await expect(text(page, 'Conversación no encontrada').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
  const before = stack.fakeApi.requests.length;
  await page.goto('/conversaciones/no-es-un-uuid');
  await expect(text(page, 'Conversación no encontrada').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
  expect(stack.fakeApi.requests.slice(before).filter((request) => request.path.includes('no-es-un-uuid'))).toEqual([]);
  expect(stack.fakeApi.requests.slice(before)).toEqual([]);
});

test('Conversación de un flujo borrado', async ({ page, admin }) => {
  await admin.publish('pregunta');
  const created = await admin.createConversation('pregunta');
  await admin.deleteFlow('pregunta');
  await page.goto(`/conversaciones/${created.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('pregunta');
  await text(page, '¿Nombre?').waitFor();
  await answer(page, 'Ana');
  await expect(text(page, 'Adiós, .')).toBeVisible();
  await expect(text(page, 'Conversación terminada')).toBeVisible();
});

test('Marcado y direcciones en un texto', async ({ page, admin }) => {
  await admin.publish('medios');
  await tryFlow(page, 'Medios');
  await text(page, 'Conversación terminada').waitFor();
  const log = page.getByRole('log');
  await expect(log).toContainText('<b>Hola</b>');
  await expect(log).toContainText('https://example.com');
  expect(await log.locator('b').count()).toBe(0);
  expect(await log.locator('a').count()).toBe(0);
  const paragraph = log.locator('p', { hasText: '<b>Hola</b>' });
  expect(await paragraph.textContent()).toBe('<b>Hola</b>\nhttps://example.com');
});

test('Multimedia del flujo de medios', async ({ page, admin, external }) => {
  await admin.publish('medios');
  await tryFlow(page, 'Medios');
  await text(page, 'Conversación terminada').waitFor();
  const log = page.getByRole('log');
  await expect(log.locator('img')).toHaveCount(1);
  await expect(log.locator('img')).toHaveAttribute('src', 'https://example.com/logo.png');
  await expect(log.locator('img')).toHaveAttribute('alt', 'Logo');
  await expect(log.locator('audio')).toHaveAttribute('src', 'https://example.com/audio.mp3');
  await expect(log.locator('iframe')).toHaveAttribute('src', 'https://example.com/widget');
  await expect(log.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(log.getByText('Contenido no disponible')).toHaveCount(5);
  await expect(log.getByText('Malo')).toHaveCount(1);
  const allowed = new Set(['https://example.com/logo.png', 'https://example.com/audio.mp3', 'https://example.com/widget']);
  for (const url of external) expect(allowed.has(url), url).toBe(true);
});

test('Una imagen admitida y otra no', async ({ page, admin, stack }) => {
  await admin.publish('preguntas');
  const created = await admin.createConversation('preguntas');
  await admin.sendAll(created.id, [{ text: ' hola ' }, { text: 'a@b.co' }, { text: '+34 600 000 000' }, { text: '5' }, { text: 'https://example.com' }, { text: '2026-10-17' }, { text: 'sí' }]);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Plan?').waitFor();
  const form = page.getByRole('form', { name: 'Tu respuesta' });
  await expect(form.getByRole('button', { name: 'Básico' }).locator('img')).toHaveAttribute('src', 'https://example.com/basico.png');
  await expect(form.getByRole('button', { name: 'Pro' }).locator('img')).toHaveCount(0);
  expect(await page.content()).not.toContain('javascript:');
  await form.getByRole('button', { name: 'Pro' }).click();
  await text(page, '¿Extras?').waitFor();
  expect(stack.fakeApi.requests.filter((request) => request.path.endsWith('/inputs')).map((request) => request.body)).toEqual(['{"input":{"choice":"pro"}}']);
});
