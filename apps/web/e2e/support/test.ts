import { test as base, expect, type Page } from '@playwright/test';
import { startStack, WEB_ORIGIN, type Stack } from './stack';
import { Admin } from './admin';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

interface Options {
  /** Orígenes (además de la web) que el navegador puede abrir: la página contenedora de «El chat dentro de un marco ajeno». */
  allowedOrigins: string[];
  /** Admite el error de consola de Chromium por `frame-ancestors` (solo ese escenario). */
  allowFrameAncestorsError: boolean;
}

interface Fixtures {
  /** Direcciones de otros orígenes que el navegador pidió: se cumplen en local, nunca salen. */
  external: string[];
  admin: Admin;
  stack: Stack;
}

interface WorkerFixtures {
  stackHolder: Stack;
}

/**
 * `test` de los E2E: la pila única por worker, el navegador sin Internet y la consola limpia (D20).
 *
 * - `context.route` deja pasar solo el origen de la web. Lo demás (p. ej. `example.com`) se **registra** y se cumple con un
 *   recurso local mínimo, en vez de abortarlo, para que no haya errores de consola.
 * - Toda página falla el test si hay un `pageerror` o un `console.error`, salvo los «Failed to load resource» de
 *   respuestas 4xx/5xx de `/api/*` del propio origen que el escenario espera y, solo con la opción, el de `frame-ancestors`.
 */
export const test = base.extend<Fixtures & Options, WorkerFixtures>({
  allowedOrigins: [[], { option: true }],
  allowFrameAncestorsError: [false, { option: true }],
  stackHolder: [
    async ({}, use) => {
      const { stack, close } = await startStack();
      try {
        await use(stack);
      } finally {
        await close();
      }
    },
    { scope: 'worker' },
  ],
  stack: async ({ stackHolder }, use) => {
    await stackHolder.reset();
    await use(stackHolder);
  },
  admin: async ({ stack }, use) => {
    await use(new Admin(stack.realApiUrl));
  },
  external: async ({ context, allowedOrigins }, use) => {
    const external: string[] = [];
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === WEB_ORIGIN || allowedOrigins.includes(url.origin)) return route.continue();
      external.push(route.request().url());
      if (/\.png$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (/\.mp3$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(0) });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
    });
    await use(external);
  },
  page: async ({ page, external, stack, allowFrameAncestorsError }, use) => {
    void external;
    void stack;
    const problems: string[] = [];
    const watch = (target: Page) => {
      target.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      target.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        const url = message.location().url;
        if (text.startsWith('Failed to load resource') && url.startsWith(`${WEB_ORIGIN}/api/`)) return;
        if (allowFrameAncestorsError && /frame-ancestors/.test(text)) return;
        problems.push(`console.error: ${text}`);
      });
    };
    watch(page);
    page.context().on('page', watch);
    await use(page);
    expect(problems, 'la consola tiene que estar limpia').toEqual([]);
  },
});

export { expect };

// ---- ayudas de los escenarios

/** Un texto visible de la página (las rutas ocultas por `<Activity>` siguen en el DOM: R7). */
export const text = (page: Page, value: string | RegExp) => page.getByText(value).filter({ visible: true });

/** El campo de respuesta de una pregunta de texto. */
export const answerBox = (page: Page) => page.locator('#answer');

/** Escribe y envía con Intro. */
export async function answer(page: Page, value: string): Promise<void> {
  await answerBox(page).fill(value);
  await answerBox(page).press('Enter');
}

export const conversationId = (page: Page): string => page.url().split('/').pop()!;

/** Abre `/` y prueba un flujo por el nombre del botón. */
export async function tryFlow(page: Page, name: string, contact?: string): Promise<void> {
  await page.goto('/');
  if (contact !== undefined) await page.getByLabel('Identificador de contacto').fill(contact);
  await page.getByRole('button', { name: `Probar ${name}`, exact: true }).click();
  await page.waitForURL(/\/conversaciones\//);
}

export const panel = (page: Page) => page.getByRole('complementary').filter({ visible: true });
