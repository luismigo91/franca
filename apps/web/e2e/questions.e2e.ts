import { CAPTACION_HASTA_TAMANO, PREGUNTAS_HASTA_PLAN } from './support/admin';
import { CONVERSATION_ID, advanceBodyOf, flowItem, messageEvent, resourceOf, scripted, textInputEvent, userItem } from './support/api-shapes';
import { sendJson } from '../tests/helpers/fake-api';
import { answer, answerBox, expect, panel, test, text, tryFlow } from './support/test';
import type { Stack } from './support/stack';

const inputBodies = (stack: Stack) => stack.fakeApi.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/inputs')).map((request) => request.body);

test('Las siete preguntas de texto', async ({ page, admin, stack }) => {
  await admin.publish('preguntas');
  await tryFlow(page, 'Preguntas');
  await text(page, '¿Texto?').waitFor();
  await expect(answerBox(page)).toHaveAttribute('placeholder', 'Escribe algo');
  const steps: Array<[string, string]> = [[' hola ', '¿Email?'], ['a@b.co', '¿Teléfono?'], ['+34 600 000 000', '¿Número?'], ['muchos', 'La respuesta no tiene el formato esperado.'], ['5', '¿Web?'], ['https://example.com', '¿Fecha?'], ['2026-10-17', '¿Aceptas?'], ['sí', '¿Plan?']];
  for (const [value, next] of steps) {
    await answer(page, value);
    await text(page, next).first().waitFor();
    if (value === 'muchos') {
      await expect(answerBox(page)).toBeVisible();
      await expect(panel(page)).toContainText('invalid_format');
      expect(await admin.conversation(page.url().split('/').pop()!).then((conversation) => (conversation.pendingInput as { nodeId: string }).nodeId)).toBe('numero');
    }
  }
  expect(inputBodies(stack)).toEqual([' hola ', 'a@b.co', '+34 600 000 000', 'muchos', '5', 'https://example.com', '2026-10-17', 'sí'].map((value) => JSON.stringify({ input: { text: value } })));
  await expect(page.getByRole('form', { name: 'Tu respuesta' }).getByRole('button', { name: 'Básico' })).toBeVisible();
});

test('Respuesta vacía', async ({ page, admin, stack }) => {
  await admin.publish('pregunta');
  const created = await admin.createConversation('pregunta');
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Nombre?').waitFor();
  await answerBox(page).press('Enter');
  await expect(text(page, 'La respuesta está vacía.')).toBeVisible();
  expect(inputBodies(stack)).toEqual(['{"input":{"text":""}}']);
  await expect(text(page, '¿Nombre?')).toHaveCount(2);
  await expect(page.getByRole('log').getByText('Respuesta vacía')).toHaveCount(1);
});

test('Tamaño de empresa', async ({ page, admin, stack }) => {
  await admin.publish('captacion-leads');
  const created = await admin.createConversation('captacion-leads');
  await admin.sendAll(created.id, CAPTACION_HASTA_TAMANO);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Cuántas personas sois en la empresa?').waitFor();
  const buttons = page.getByRole('form', { name: 'Tu respuesta' }).getByRole('button');
  await expect(buttons).toHaveText(['1 a 10', '11 a 50', 'Más de 50']);
  await expect(answerBox(page)).toHaveCount(0);
  await buttons.nth(2).click();
  await text(page, 'La conversación no ha podido continuar').waitFor();
  expect(inputBodies(stack)).toEqual(['{"input":{"choice":"grande"}}']);
});

test('Extras en el orden de las opciones', async ({ page, admin, stack }) => {
  await admin.publish('preguntas');
  const created = await admin.createConversation('preguntas');
  await admin.sendAll(created.id, [...PREGUNTAS_HASTA_PLAN, { choice: 'pro' }]);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Extras?').waitFor();
  const form = page.getByRole('form', { name: 'Tu respuesta' });
  await expect(form.getByRole('checkbox')).toHaveCount(3);
  for (const name of ['Informes', 'Soporte', 'Formación']) await form.getByLabel(name).check();
  await form.getByRole('button', { name: 'Enviar' }).click();
  await expect(text(page, 'La respuesta está fuera de lo permitido.')).toBeVisible();
  await expect(panel(page)).toContainText('out_of_range');
  for (const name of ['Informes', 'Soporte']) await form.getByLabel(name).check();
  await form.getByRole('button', { name: 'Enviar' }).click();
  await text(page, 'Conversación terminada').waitFor();
  expect(inputBodies(stack)).toEqual(['{"input":{"choices":["a","b","c"]}}', '{"input":{"choices":["a","c"]}}']);
  await expect(text(page, 'completo').first()).toBeVisible();
  await expect(form).toHaveCount(0);
});

test('Ninguna marcada', async ({ page, admin, stack }) => {
  await admin.publish('preguntas');
  const created = await admin.createConversation('preguntas');
  await admin.sendAll(created.id, [...PREGUNTAS_HASTA_PLAN, { choice: 'pro' }]);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Extras?').waitFor();
  await page.getByRole('form', { name: 'Tu respuesta' }).getByRole('button', { name: 'Enviar' }).click();
  await expect(text(page, 'La respuesta está vacía.')).toBeVisible();
  expect(inputBodies(stack)).toEqual(['{"input":{"choices":[]}}']);
  await expect(page.getByRole('form', { name: 'Tu respuesta' }).getByRole('checkbox')).toHaveCount(3);
});

test('Email inválido en el ejemplo', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  const created = await admin.createConversation('captacion-leads');
  await admin.send(created.id, { text: 'Ana' });
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿A qué email te escribimos?').waitFor();
  await answer(page, 'ana@');
  await expect(text(page, 'Ese email no parece válido, ¿lo revisas?')).toBeVisible();
  await expect(text(page, 'La respuesta no tiene el formato esperado.')).toBeVisible();
  await expect(answerBox(page)).toHaveAttribute('aria-describedby', 'answer-reason');
  await answer(page, 'ana@example.com');
  await text(page, '¿Cuántas personas sois en la empresa?').waitFor();
  await expect(text(page, 'La respuesta no tiene el formato esperado.')).toHaveCount(0);
});

test('Mensaje rechazado en un llm', async ({ page, stack }) => {
  const world = {
    conversation: resourceOf({ pendingInput: { type: 'input', nodeId: 'a', inputType: 'text', attempt: 1, reason: null } }),
    items: [flowItem(1, messageEvent('a', 'Pregúntame.')), flowItem(2, textInputEvent('a'))],
  };
  stack.fakeApi.respond(
    scripted(world, (_request, response) => {
      world.conversation = resourceOf({ revision: 2, pendingInput: { type: 'input', nodeId: 'a', inputType: 'text', attempt: 2, reason: 'too_long' } });
      sendJson(response, 200, advanceBodyOf(world.conversation, [{ type: 'input', nodeId: 'a', inputType: 'text', attempt: 2, reason: 'too_long' }]));
    }),
  );
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, 'Pregúntame.').waitFor();
  await answer(page, 'respuesta enorme');
  await expect(text(page, 'La respuesta es demasiado larga.')).toBeVisible();
  const flowMessages = page.getByRole('log').locator('p.whitespace-pre-wrap');
  await expect(flowMessages).toHaveText(['Pregúntame.', 'respuesta enorme']);
});

test('Etiqueta de la opción en directo y al reabrir', async ({ page, admin }) => {
  await admin.publish('preguntas');
  const created = await admin.createConversation('preguntas');
  await admin.sendAll(created.id, [...PREGUNTAS_HASTA_PLAN, { choice: 'pro' }]);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Extras?').waitFor();
  const form = page.getByRole('form', { name: 'Tu respuesta' });
  await form.getByLabel('Informes').check();
  await form.getByLabel('Soporte').check();
  await form.getByRole('button', { name: 'Enviar' }).click();
  await text(page, 'Conversación terminada').waitFor();
  const lastUser = async () => {
    const users = await page.getByRole('log').locator('div.justify-end p').allInnerTexts();
    return users.at(-1);
  };
  expect(await lastUser()).toBe('Soporte, Informes');
  await page.reload();
  await text(page, 'Conversación terminada').waitFor();
  expect(await lastUser()).toBe('Soporte, Informes');
});

test('Tipo de pregunta futuro', async ({ page, stack }) => {
  const pendingInput = { type: 'input', nodeId: 'q', inputType: 'firma', attempt: 1, reason: null };
  const world = { conversation: resourceOf({ pendingInput }), items: [flowItem(1, messageEvent('q', 'Firma aquí.')), flowItem(2, pendingInput), userItem(3, { text: 'x' })].slice(0, 2) };
  stack.fakeApi.respond(scripted(world, () => undefined));
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await expect(text(page, 'Esta pregunta no se puede responder desde el chat de prueba.')).toBeVisible();
  await expect(page.locator('main textarea, main input[type=text], main input[type=checkbox]:visible')).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'Tu respuesta' })).toHaveCount(0);
  await expect(panel(page)).toContainText('Detalles de la prueba');
});
