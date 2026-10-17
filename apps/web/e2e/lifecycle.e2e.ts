import { CAPTACION_HASTA_TAMANO, PREGUNTAS_HASTA_PLAN } from './support/admin';
import { CONVERSATION_ID, advanceBodyOf, flowItem, messageEvent, resourceOf, scripted, textInputEvent } from './support/api-shapes';
import { sendJson } from '../tests/helpers/fake-api';
import { FLOWS } from '../tests/helpers/engine-events';
import { answer, answerBox, conversationId, expect, panel, test, text, tryFlow } from './support/test';

type Json = Record<string, unknown>;

test('Fallo del nodo http del ejemplo', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  const created = await admin.createConversation('captacion-leads');
  await admin.sendAll(created.id, CAPTACION_HASTA_TAMANO);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Cuántas personas sois en la empresa?').waitFor();
  await page.getByRole('button', { name: 'Más de 50' }).click();
  await text(page, 'La conversación no ha podido continuar').waitFor();
  expect(await page.locator('body').innerText()).not.toContain('el host no tiene un secreto');
  await page.reload();
  await text(page, 'La conversación no ha podido continuar').waitFor();
  expect(await page.locator('body').innerText()).not.toContain('el host no tiene un secreto');
  await expect(panel(page)).toContainText('missing_secret');
});

test('Evento desconocido', async ({ page, stack, external }) => {
  const world = { conversation: resourceOf({ pendingInput: textInputEvent('p') }), items: [flowItem(1, messageEvent('p', '¿Nombre?')), flowItem(2, textInputEvent('p'))] };
  stack.fakeApi.respond(
    scripted(world, (_request, response) => {
      const conversation = resourceOf({ revision: 2, pendingInput: textInputEvent('q') });
      sendJson(
        response,
        200,
        advanceBodyOf(conversation, [
          { type: 'nuevo', nodeId: 'x' },
          { type: 'message', nodeId: 'q', content: [{ kind: 'mapa', url: 'https://example.com/m' }, { kind: 'text', text: 'Sigo' }], typingDelayMs: 0 },
          textInputEvent('q'),
        ]),
      );
    }),
  );
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, '¿Nombre?').waitFor();
  await answer(page, 'Ana');
  await expect(text(page, 'Sigo')).toBeVisible();
  await expect(answerBox(page)).toBeVisible();
  expect(external.filter((url) => url.includes('example.com/m'))).toEqual([]);
});

test('Final con outcome', async ({ page, admin }) => {
  await admin.publish('preguntas');
  const created = await admin.createConversation('preguntas');
  await admin.sendAll(created.id, [...PREGUNTAS_HASTA_PLAN, { choice: 'pro' }]);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Extras?').waitFor();
  await page.getByLabel('Soporte').check();
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(text(page, 'Gracias.')).toBeVisible();
  await expect(text(page, 'Conversación terminada')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conversación terminada' })).toContainText('completo');
  await expect(page.getByRole('form', { name: 'Tu respuesta' })).toHaveCount(0);
});

test('Reintentos agotados', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  const created = await admin.createConversation('captacion-leads');
  await admin.send(created.id, { text: 'Ana' });
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿A qué email te escribimos?').waitFor();
  for (const value of ['a', 'b', 'c']) {
    await answer(page, value);
    if (value !== 'c') await expect(answerBox(page)).toBeVisible();
  }
  await expect(text(page, 'La conversación no ha podido continuar')).toBeVisible();
  await expect(answerBox(page)).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('se agotaron los reintentos');
});

test('Probar la versión nueva', async ({ page, admin }) => {
  await admin.publish('pregunta');
  await tryFlow(page, 'Pregunta', 'c-1');
  await text(page, '¿Nombre?').waitFor();
  const firstUrl = page.url();
  const changed = structuredClone(FLOWS.pregunta) as Json;
  const prompt = (changed.nodes as Json[])[0]!;
  prompt.prompt = [{ kind: 'text', text: '¿Cómo te llamas?' }];
  await admin.updateDraft(changed);
  await admin.publishDraft('pregunta');
  await page.getByRole('button', { name: 'Empezar de nuevo' }).click();
  await page.waitForURL((url) => url.toString() !== firstUrl && url.pathname.startsWith('/conversaciones/'));
  await expect(text(page, '¿Cómo te llamas?')).toBeVisible();
  await expect(page.getByText('Versión 2').first()).toBeVisible();
  await expect(panel(page)).toContainText('c-1');
  expect((await admin.listConversations()).total).toBe(2);
});

test('Borrar y cancelar', async ({ page, admin, stack }) => {
  await admin.publish('pregunta');
  await tryFlow(page, 'Pregunta');
  await text(page, '¿Nombre?').waitFor();
  const id = conversationId(page);
  await page.getByRole('button', { name: 'Borrar conversación' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('El borrado es definitivo y no borra los datos guardados del contacto.');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  expect(stack.fakeApi.requests.filter((request) => request.method === 'DELETE')).toEqual([]);
  await page.getByRole('button', { name: 'Borrar conversación' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.waitForURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Conversaciones recientes' })).toBeVisible();
  expect(stack.fakeApi.requests.filter((request) => request.method === 'DELETE').map((request) => request.path)).toEqual([`/conversations/${id}`]);
  await expect(text(page, 'Aún no se ha probado ningún flujo.')).toBeVisible();
  await expect(page.locator(`a[href="/conversaciones/${id}"]`).filter({ visible: true })).toHaveCount(0);
  expect((await admin.listConversations()).total).toBe(0);
});

test('Fallo de llm sin credenciales', async ({ page, admin }) => {
  await admin.publish('faq-ia');
  await tryFlow(page, 'FAQ con IA y escalado a humano');
  await expect(text(page, 'Hola, soy el asistente. Pregúntame lo que necesites sobre el servicio.')).toBeVisible();
  await expect(text(page, 'La conversación no ha podido continuar')).toBeVisible();
  const details = panel(page);
  for (const expected of ['Fallida', 'llm_not_configured', 'asistente', '0 USD']) await expect(details).toContainText(expected);
  expect(await page.locator('body').innerText()).not.toContain('el proveedor o el modelo del nodo no están configurados');
});

test('Intento de la pregunta pendiente', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  const created = await admin.createConversation('captacion-leads');
  await admin.send(created.id, { text: 'Ana' });
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿A qué email te escribimos?').waitFor();
  await answer(page, 'ana@');
  await text(page, 'Ese email no parece válido, ¿lo revisas?').waitFor();
  const details = panel(page);
  await expect(details.locator('div', { has: page.getByText('Intento de la pregunta') }).last()).toContainText('2');
  await expect(details).toContainText('invalid_format');
  await expect(details.locator('div', { has: page.getByText('Revisión', { exact: true }) }).last()).toContainText('3');
});

test('Llamada bloqueada y turno de llm', async ({ page, stack }) => {
  const world = {
    conversation: resourceOf({ status: 'ended', outcome: 'lead-sin-enviar', pendingInput: null, expiresAt: null }),
    items: [
      flowItem(1, messageEvent('inicio', 'Hola.')),
      flowItem(2, { type: 'llm', nodeId: 'asistente', turns: 2, costUsd: 0.02, reason: null }),
      flowItem(3, { type: 'http', nodeId: 'enviar-crm', attempts: 1, status: null, error: 'blocked' }),
      flowItem(4, { type: 'end', nodeId: 'fin', outcome: 'lead-sin-enviar' }),
    ],
  };
  stack.fakeApi.respond(scripted(world, () => undefined));
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, 'Conversación terminada').waitFor();
  const details = panel(page);
  const llm = details.getByText(/LLM en asistente/);
  const http = details.getByText(/HTTP en enviar-crm/);
  await expect(llm).toContainText('2 turnos');
  await expect(llm).toContainText('0.02 USD');
  await expect(http).toContainText('1 intento');
  await expect(http).toContainText('blocked');
  const order = await details.locator('ol li').allInnerTexts();
  expect(order[0]).toContain('LLM en asistente');
  expect(order[1]).toContain('HTTP en enviar-crm');
  const log = await page.getByRole('log').innerText();
  expect(log).not.toContain('asistente');
  expect(log).not.toContain('enviar-crm');
});
