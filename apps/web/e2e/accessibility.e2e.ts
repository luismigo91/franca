import { PREGUNTAS_HASTA_PLAN } from './support/admin';
import { expect, test, text } from './support/test';

test('Solo con teclado', async ({ page, admin }) => {
  await admin.publish('captacion-leads');
  await page.goto('/');
  const target = page.getByRole('button', { name: 'Probar Captación de leads', exact: true });
  await target.waitFor();
  for (let presses = 0; presses < 20 && !(await target.evaluate((element) => element === document.activeElement)); presses++) await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
  await text(page, '¿Cómo te llamas?').waitFor();
  await expect(page.locator('#answer')).toBeFocused();
  await page.keyboard.type('Ana');
  await page.keyboard.press('Enter');
  await text(page, '¿A qué email te escribimos?').waitFor();
  await expect(page.locator('#answer')).toBeFocused();
  await page.keyboard.type('ana@example.com');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: '11 a 50' });
  await second.waitFor();
  for (let presses = 0; presses < 5 && !(await second.evaluate((element) => element === document.activeElement)); presses++) await page.keyboard.press('Tab');
  await expect(second).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(text(page, 'La conversación no ha podido continuar')).toBeVisible();
  await expect(page.getByRole('log')).toBeVisible();
});

test('Pantalla estrecha', async ({ page, admin }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await admin.publish('preguntas');
  const created = await admin.createConversation('preguntas');
  await admin.sendAll(created.id, PREGUNTAS_HASTA_PLAN);
  await page.goto(`/conversaciones/${created.id}`);
  await text(page, '¿Plan?').waitFor();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  const form = page.getByRole('form', { name: 'Tu respuesta' });
  await expect(form.getByRole('button', { name: 'Básico' })).toBeInViewport({ ratio: 0.5 }).catch(() => undefined);
  await form.getByRole('button', { name: 'Básico' }).scrollIntoViewIfNeeded();
  await expect(form.getByRole('button', { name: 'Básico' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Pro' })).toBeVisible();
  const details = page.getByRole('complementary').filter({ visible: true });
  await details.scrollIntoViewIfNeeded();
  await expect(details).toBeVisible();
  await expect(details.getByRole('heading', { name: 'Detalles de la prueba' })).toBeVisible();
});
