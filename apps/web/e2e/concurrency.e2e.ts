import { CAPTACION_HASTA_TAMANO } from './support/admin';
import { CONVERSATION_ID, flowItem, messageEvent, resourceOf, scripted, textInputEvent, userItem } from './support/api-shapes';
import { sendJson } from '../tests/helpers/fake-api';
import { answer, answerBox, expect, test, text, tryFlow } from './support/test';
import type { Stack } from './support/stack';

const posts = (stack: Stack) => stack.fakeApi.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/inputs'));

function waitingWorld() {
  return {
    conversation: resourceOf({ pendingInput: textInputEvent('p') }),
    items: [flowItem(1, messageEvent('p', '¿Nombre?')), flowItem(2, textInputEvent('p'))],
  };
}

test('If-Match en las respuestas', async ({ page, admin, stack }) => {
  await admin.publish('pregunta');
  await tryFlow(page, 'Pregunta');
  await text(page, '¿Nombre?').waitFor();
  await answer(page, '   ');
  await expect(text(page, 'La respuesta está vacía.')).toBeVisible();
  await answer(page, 'Ana');
  await text(page, 'Conversación terminada').waitFor();
  expect(posts(stack).map((request) => request.headers['if-match'])).toEqual(['"1"', '"2"']);
});

test('Doble clic en una opción', async ({ page, admin, stack }) => {
  await admin.publish('captacion-leads');
  const created = await admin.createConversation('captacion-leads');
  await admin.sendAll(created.id, CAPTACION_HASTA_TAMANO);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Cuántas personas sois en la empresa?').waitFor();
  await page.getByRole('button', { name: '1 a 10' }).dblclick();
  await text(page, 'La conversación no ha podido continuar').waitFor();
  expect(posts(stack)).toHaveLength(1);
  const choices = (await admin.transcript(created.id)).filter((item) => item.role === 'user' && 'choice' in (item.input as object));
  expect(choices).toHaveLength(1);
});

test('Respuesta perdida después de aplicarse', async ({ page, stack }) => {
  const world = waitingWorld();
  stack.fakeApi.respond(
    scripted(world, (_request, _response, socket, state) => {
      state.conversation = resourceOf({ revision: 2, status: 'ended', outcome: 'ok', pendingInput: null });
      state.items = [...state.items, userItem(3, { text: 'Ana' }), flowItem(4, messageEvent('fin', 'Adiós, Ana.')), flowItem(5, { type: 'end', nodeId: 'fin', outcome: 'ok' })];
      socket.destroy();
    }),
  );
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, '¿Nombre?').waitFor();
  await answer(page, 'Ana');
  await text(page, 'Adiós, Ana.').waitFor();
  expect(posts(stack)).toHaveLength(1);
  const after = stack.fakeApi.requests.slice(stack.fakeApi.requests.indexOf(posts(stack)[0]!) + 1).map((request) => request.path);
  expect(after).toContain(`/conversations/${CONVERSATION_ID}`);
  expect(after.some((path) => path.includes('/transcript'))).toBe(true);
  expect(after.filter((path) => path.endsWith('/inputs'))).toEqual([]);
  await expect(page.getByRole('log').locator('div.justify-end p', { hasText: 'Ana' })).toHaveCount(1);
});

test('Dos pestañas', async ({ page, admin, context }) => {
  await admin.publish('pregunta');
  const created = await admin.createConversation('pregunta');
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Nombre?').waitFor();
  const second = await context.newPage();
  await second.goto(`/conversaciones/${created.id}`);
  await second.getByText('¿Nombre?').filter({ visible: true }).waitFor();
  await answer(page, '   ');
  await expect(text(page, 'La respuesta está vacía.')).toBeVisible();
  await second.locator('#answer').fill('Ana');
  await second.locator('#answer').press('Enter');
  await expect(second.getByText('La conversación ha avanzado en otra pestaña.')).toBeVisible();
  await expect(second.getByText('La respuesta está vacía.')).toBeVisible();
  await expect(second.locator('#answer')).toHaveValue('Ana');
  expect((await admin.transcript(created.id)).filter((item) => item.role === 'user')).toHaveLength(1);
  await second.close();
});

test('Ocupada al enviar', async ({ page, stack }) => {
  await page.clock.install();
  const world = waitingWorld();
  stack.fakeApi.respond(scripted(world, (_request, response) => sendJson(response, 409, { message: 'otra entrada en curso', error: 'conversation_busy' })));
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, '¿Nombre?').waitFor();
  await answer(page, 'Ana');
  await expect(page.getByText('La conversación está procesando otra respuesta.')).toBeVisible();
  await expect(answerBox(page)).toHaveValue('Ana');
  const countAfterSend = stack.fakeApi.requests.length;
  await page.clock.runFor(10_000);
  await page.waitForTimeout(300);
  expect(stack.fakeApi.requests.length).toBe(countAfterSend);
  await page.getByRole('button', { name: 'Volver a cargar' }).click();
  await expect.poll(() => stack.fakeApi.requests.slice(countAfterSend).map((request) => request.path)).toContain(`/conversations/${CONVERSATION_ID}`);
  await expect(answerBox(page)).toHaveValue('Ana');
});

test('Caducada al responder', async ({ page, stack }) => {
  const world = waitingWorld();
  stack.fakeApi.respond(
    scripted(world, (_request, response, _socket, state) => {
      state.conversation = resourceOf({ status: 'expired', pendingInput: null });
      sendJson(response, 409, { message: 'caducó', error: 'conversation_expired' });
    }),
  );
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, '¿Nombre?').waitFor();
  await answer(page, 'Ana');
  await expect(text(page, 'La conversación ha caducado por inactividad')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empezar de nuevo' })).toBeVisible();
  await expect(answerBox(page)).toHaveCount(0);
});

test('Respuesta enorme', async ({ page, admin }) => {
  await admin.publish('pregunta');
  const created = await admin.createConversation('pregunta');
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Nombre?').waitFor();
  await answerBox(page).fill('a'.repeat(70_000));
  await answerBox(page).press('Enter');
  await expect(text(page, 'La respuesta es demasiado larga para enviarla.')).toBeVisible();
  expect(await answerBox(page).inputValue()).toHaveLength(70_000);
  const conversation = await admin.conversation(created.id);
  expect(conversation.revision).toBe(1);
  expect((conversation.pendingInput as { nodeId: string }).nodeId).toBe('p');
});

test('Conversación borrada desde otra pestaña', async ({ page, admin }) => {
  await admin.publish('pregunta');
  const created = await admin.createConversation('pregunta');
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Nombre?').waitFor();
  await admin.deleteConversation(created.id);
  await answer(page, 'Ana');
  await expect(text(page, 'Esta conversación ya no existe.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver al inicio' }).first()).toHaveAttribute('href', '/');
});

test('Código desconocido', async ({ page, stack }) => {
  const world = waitingWorld();
  stack.fakeApi.respond(scripted(world, (_request, response) => sendJson(response, 409, { message: 'MARCA-MENSAJE', error: 'codigo_nuevo' })));
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, '¿Nombre?').waitFor();
  await answer(page, 'Ana');
  await expect(text(page, 'No se ha podido enviar la respuesta.')).toBeVisible();
  await expect(answerBox(page)).toHaveValue('Ana');
  expect(await page.content()).not.toContain('MARCA-MENSAJE');
});
