import { CONVERSATION_ID, advanceBodyOf, delay, flowItem, messageEvent, resourceOf, scripted, textInputEvent } from './support/api-shapes';
import { sendJson } from '../tests/helpers/fake-api';
import { answer, expect, test, text } from './support/test';

declare global {
  interface Window {
    __marks?: Record<string, number>;
  }
}

test('Retardo por defecto del ejemplo', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  await page.goto('/');
  await page.evaluate(() => {
    window.__marks = {};
    const check = () => {
      const marks = window.__marks!;
      const now = performance.now();
      const body = document.body.innerText;
      if (marks.typing === undefined && body.includes('Escribiendo…')) marks.typing = now;
      if (marks.hola === undefined && body.includes('¡Hola! Te hago tres preguntas')) marks.hola = now;
      if (marks.nombre === undefined && body.includes('¿Cómo te llamas?')) marks.nombre = now;
      if (marks.campo === undefined && document.querySelector('#answer')) marks.campo = now;
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Probar Captación de leads', exact: true }).click();
  await page.locator('#answer').waitFor();
  const marks = await page.evaluate(() => window.__marks!);
  expect(marks.typing, 'el indicador se ve antes del primer mensaje').toBeLessThan(marks.hola!);
  expect(marks.nombre! - marks.hola!, 'al menos 600 ms entre los dos mensajes').toBeGreaterThanOrEqual(600);
  expect(marks.campo!, 'el campo no aparece antes que la pregunta').toBeGreaterThanOrEqual(marks.nombre!);
});

function slowWorld(delayMs: number) {
  const world = {
    conversation: resourceOf({ pendingInput: textInputEvent('p') }),
    items: [flowItem(1, messageEvent('p', '¿Nombre?')), flowItem(2, textInputEvent('p'))],
  };
  const handler = scripted(world, async (_request, response) => {
    await delay(delayMs);
    const conversation = resourceOf({ revision: 2, status: 'ended', outcome: 'ok', pendingInput: null });
    sendJson(response, 200, advanceBodyOf(conversation, [messageEvent('fin', 'Adiós, Ana.'), { type: 'end', nodeId: 'fin', outcome: 'ok' }]));
  });
  return handler;
}

test('Indicador mientras la API responde', async ({ page, stack }) => {
  stack.fakeApi.respond(slowWorld(5000));
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, '¿Nombre?').waitFor();
  await answer(page, 'Ana');
  const typing = page.getByText('Escribiendo…').filter({ visible: true });
  await expect(typing).toBeVisible();
  const started = Date.now();
  await page.waitForTimeout(3500);
  await expect(typing).toBeVisible();
  await text(page, 'Adiós, Ana.').waitFor({ timeout: 10_000 });
  expect(Date.now() - started).toBeGreaterThan(1000);
  await expect(typing).toHaveCount(0);
});

test('Avance largo', { tag: '@lento' }, async ({ page, stack }) => {
  test.setTimeout(200_000);
  stack.fakeApi.respond(slowWorld(150_000));
  await page.goto(`/conversaciones/${CONVERSATION_ID}`);
  await text(page, '¿Nombre?').waitFor();
  await answer(page, 'Ana');
  await text(page, 'Adiós, Ana.').waitFor({ timeout: 190_000 });
  // El anunciador de rutas de Next también es un role=alert: se mira solo dentro de la pantalla.
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  await expect(text(page, 'Conversación terminada')).toBeVisible();
});
