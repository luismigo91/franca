import type { Page } from '@playwright/test';
import { FLOWS } from '../tests/helpers/engine-events';
import { bodyOf, countRequests, dragOutput, fitCanvas, inspector, lastRequest, node, openEditor, screen } from './support/editor';
import { expect, test } from './support/test';

// QA independiente del editor (web-editor, 2026-10-18): equivalencias, deshacer a mano, nombres de cabecera que son punteros
// RFC 6901, diálogos con `<Activity>`, crear desde JSON pegado en los límites y tres defectos conocidos (`test.fail`: pasan
// mientras el defecto exista y fallan, para que alguien los convierta en `test`, cuando se corrija).

type Json = Record<string, unknown>;

const save = (page: Page) => screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
const dirty = (page: Page) => screen(page).getByText('Cambios sin guardar', { exact: true });

/** El texto de «Ver JSON», con el diálogo cerrado después. */
async function viewJson(page: Page): Promise<string> {
  await screen(page).getByRole('button', { name: 'Ver JSON' }).click();
  const value = await page.getByLabel('Texto JSON (solo lectura)').inputValue();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  return value;
}

/** Descripción del elemento con el foco: `BODY` si el foco cayó a la página. */
const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const element = document.activeElement;
    return element === null || element === document.body ? 'BODY' : `${element.tagName.toLowerCase()}#${element.id}`;
  });

const HTTP_FLOW: Json = {
  specVersion: '0.1',
  id: 'cabeceras',
  name: 'Cabeceras',
  start: 'h',
  nodes: [
    { id: 'h', type: 'http', request: { method: 'GET', url: 'https://example.com/x', headers: { 'X-One': 'a' } }, onError: 'fin', next: 'fin' },
    { id: 'fin', type: 'end' },
  ],
};

test('El arrastre y el inspector dan exactamente el mismo texto, posiciones incluidas', async ({ page, admin, context }) => {
  await admin.createDraft('captacion-leads');
  const other = await context.newPage();
  await openEditor(page, 'captacion-leads');
  await openEditor(other, 'captacion-leads');
  await fitCanvas(page);
  await dragOutput(page, 'ruta-segmento', 'else', 'fin-empresa');
  await node(other, 'ruta-segmento').focus();
  await other.keyboard.press('Enter');
  await other.getByLabel('Si no (else)').selectOption('fin-empresa');
  const dragged = await viewJson(page);
  const chosen = await viewJson(other);
  expect(dragged).toBe(chosen);
  // Las dos vías fijan la posición de todos los nodos (la spec: «nada cambia de sitio después»).
  for (const each of JSON.parse(dragged).nodes as Json[]) expect(each.position, String(each.id)).toBeDefined();
});

test('Soltar en vacío, fuera, con Escape o con Escape y seguir moviendo no cambia nada', async ({ page, admin, stack }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await fitCanvas(page);
  const before = await viewJson(page);
  await dragOutput(page, 'ruta-segmento', 'else', 'vacío');
  await dragOutput(page, 'ruta-segmento', 'else', 'fuera');
  await dragOutput(page, 'ruta-segmento', 'else', 'escape', 'fin-empresa');
  // Escape y, sin soltar, seguir moviendo el ratón y soltar sobre otro nodo: tampoco conecta.
  const output = (await node(page, 'ruta-segmento').locator('[data-output="else"]').boundingBox())!;
  const target = (await node(page, 'fin-pyme').boundingBox())!;
  await page.mouse.move(output.x + output.width / 2, output.y + output.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 20, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.move(target.x + 60, target.y + 25, { steps: 3 });
  await page.mouse.up();
  expect(await viewJson(page)).toBe(before);
  await expect(dirty(page)).toHaveCount(0);
  await save(page);
  await expect(screen(page).getByText('No hay cambios que guardar.')).toBeVisible();
  expect(countRequests(stack, 'PUT', '/flows/captacion-leads')).toBe(0);
});

test('Cabeceras cuyo nombre es un puntero RFC 6901 traicionero', async ({ page, admin, stack }) => {
  await admin.createDraft(HTTP_FLOW);
  await openEditor(page, 'cabeceras');
  await node(page, 'h').click();
  const form = inspector(page).getByRole('group', { name: 'Nueva cabecera' });
  const names = ['a/b', 'x~y', '-', '10', '__proto__', 'constructor'];
  for (const name of names) {
    await form.getByLabel('Nombre de la cabecera').fill(name);
    await form.getByLabel('Valor de la cabecera').fill(`v-${name}`);
    await form.getByRole('button', { name: 'Añadir cabecera' }).click();
    await expect(inspector(page).getByRole('group', { name: `Cabecera ${name}` })).toBeVisible();
  }
  const draft = async () => (JSON.parse(await viewJson(page)).nodes[0].request.headers as Json);
  let current = await draft();
  expect(Object.keys(current).sort()).toEqual(['X-One', ...names].sort());
  expect(Object.hasOwn(current, '__proto__')).toBe(true);
  for (const name of names) expect(Object.getOwnPropertyDescriptor(current, name)?.value, name).toBe(`v-${name}`);
  // Editar un valor y renombrar caen en la cabecera correcta, no en la «hermana» que se parece al escapar el puntero.
  await inspector(page).getByRole('group', { name: 'Cabecera x~y' }).getByLabel('Valor', { exact: true }).fill('nuevo');
  const rename = inspector(page).getByRole('group', { name: 'Cabecera a/b' }).getByLabel('Nombre', { exact: true });
  await rename.fill('c/d');
  await rename.press('Enter');
  await inspector(page).getByRole('button', { name: 'Quitar la cabecera -' }).click();
  current = await draft();
  expect(Object.keys(current).sort()).toEqual(['X-One', '10', '__proto__', 'c/d', 'constructor', 'x~y'].sort());
  expect(Object.getOwnPropertyDescriptor(current, 'x~y')?.value).toBe('nuevo');
  expect(Object.getOwnPropertyDescriptor(current, 'c/d')?.value).toBe('v-a/b');
  expect(Object.getOwnPropertyDescriptor(current, '__proto__')?.value).toBe('v-__proto__');
  await save(page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  const sent = (bodyOf(lastRequest(stack, 'PUT', '/flows/cabeceras')).nodes as Json[])[0]!.request as Json;
  expect(Object.keys(sent.headers as Json).sort()).toEqual(['X-One', '10', '__proto__', 'c/d', 'constructor', 'x~y'].sort());
  const stored = ((await admin.flow('cabeceras')).flow.nodes as Json[])[0]!.request as Json;
  expect(Object.getOwnPropertyDescriptor(stored.headers as Json, '__proto__')?.value).toBe('v-__proto__');
  await expect(dirty(page)).toHaveCount(0);
});

test('Deshacer a mano vuelve a «Sin cambios», con contenedores vacíos guardados y el orden de claves del guardado', async ({ page, admin }) => {
  // Claves en un orden poco habitual y contenedores opcionales vacíos ya guardados: el texto tiene que volver a ser idéntico.
  const flow = {
    nodes: [
      { type: 'message', next: 'q', id: 'm', content: [{ kind: 'text', text: 'Hola' }] },
      { id: 'q', type: 'input', inputType: 'text', variable: 'v', prompt: [{ kind: 'text', text: '?' }], validation: {}, next: 'h' },
      { id: 'h', type: 'http', request: { url: 'https://example.com/x', method: 'GET', headers: {} }, next: 'fin', onError: 'fin' },
      { id: 'fin', type: 'end' },
    ],
    start: 'm',
    name: 'Orden',
    id: 'orden',
    specVersion: '0.1',
    settings: {},
    variables: [{ name: 'v', type: 'string' }],
  };
  await admin.createDraft(flow);
  await openEditor(page, 'orden');
  const saved = await viewJson(page);
  expect(saved).toBe(JSON.stringify(flow));
  const flowPanel = () => page.locator('#flow-canvas').filter({ visible: true }).click({ position: { x: 3, y: 3 } });
  const back = async (label: string, change: () => Promise<unknown>) => {
    await change();
    expect(await viewJson(page), label).toBe(saved);
    await expect(dirty(page), label).toHaveCount(0);
  };
  const changed = async (label: string, change: () => Promise<unknown>) => {
    await change();
    expect(await viewJson(page), label).not.toBe(saved);
    await expect(dirty(page), label).toBeVisible();
  };
  await flowPanel();
  const field = (name: string | RegExp) => inspector(page).getByLabel(name, { exact: typeof name === 'string' });
  await changed('nombre', () => field('Nombre').fill('Otro'));
  await back('nombre', () => field('Nombre').fill('Orden'));
  await changed('descripción', () => field('Descripción').fill('x'));
  await back('descripción', () => field('Descripción').fill(''));
  await changed('locale', () => field('Idioma (locale)').fill('es'));
  await back('locale', () => field('Idioma (locale)').fill(''));
  await changed('settings.typingDelayMs', () => field('Retardo de escritura (ms)').fill('5'));
  await back('settings.typingDelayMs (settings {} guardado)', () => field('Retardo de escritura (ms)').fill(''));
  await changed('variable nueva', () => inspector(page).getByRole('button', { name: /Añadir variable/ }).click());
  await back('variable nueva quitada', () => inspector(page).getByRole('button', { name: /Quitar/ }).last().click());
  await node(page, 'h').click();
  const form = inspector(page).getByRole('group', { name: 'Nueva cabecera' });
  await changed('cabecera', async () => {
    await form.getByLabel('Nombre de la cabecera').fill('X-A');
    await form.getByLabel('Valor de la cabecera').fill('1');
    await form.getByRole('button', { name: 'Añadir cabecera' }).click();
  });
  await back('cabecera quitada (headers {} guardado)', () => inspector(page).getByRole('button', { name: 'Quitar la cabecera X-A' }).click());
  await node(page, 'q').click();
  await changed('validation.min', () => field('Mínimo').fill('3'));
  await back('validation.min (validation {} guardado)', () => field('Mínimo').fill(''));
  await changed('título', () => field('Título').fill('T'));
  await back('título', () => field('Título').fill(''));
  await changed('renombrar q', async () => {
    await field('Identificador').fill('q2');
    await field('Identificador').press('Enter');
  });
  await back('renombrar de vuelta', async () => {
    await field('Identificador').fill('q');
    await field('Identificador').press('Enter');
  });
});

/** Las formas de abrir cada diálogo del editor (los cinco de la ruta del flujo). */
function dialogOpeners(page: Page): [string, () => Promise<unknown>][] {
  return [
    ['Ver JSON', () => screen(page).getByRole('button', { name: 'Ver JSON' }).click()],
    ['Descartar', () => screen(page).getByRole('button', { name: 'Descartar cambios' }).click()],
    ['Borrar flujo', () => screen(page).getByRole('button', { name: 'Borrar flujo' }).click()],
    [
      'Editar como JSON',
      async () => {
        await node(page, 'bienvenida').click();
        await inspector(page).getByRole('button', { name: /Editar como JSON/ }).click();
      },
    ],
    [
      'Borrar nodo',
      async () => {
        await node(page, 'bienvenida').click();
        await inspector(page).getByRole('button', { name: /Borrar nodo/ }).click();
      },
    ],
  ];
}

/** Entra al editor por un enlace de la web (navegación del cliente: la ruta anterior queda oculta con `<Activity>`). */
async function enterEditor(page: Page): Promise<void> {
  await page.goto('/flujos');
  await page.locator('a[href="/flujos/captacion-leads"]').click();
  await page.locator('#editor-title').waitFor();
}

test('Diálogos abiertos y el navegador atrás: la ruta oculta no deja ningún diálogo modal', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  for (const [label, open] of dialogOpeners(page)) {
    await enterEditor(page);
    await open();
    await expect(page.locator('dialog[open]'), `${label}: abierto`).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(/\/flujos$/);
    await expect(page.locator('dialog[open]'), `${label}: cerrado al ocultar la ruta`).toHaveCount(0);
    // La lista es interactiva (un `<dialog>` modal olvidado bloquearía todo lo demás).
    await expect(page.locator('a[href="/flujos/captacion-leads"]')).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
});

// QA-5: el estado de «qué diálogo está abierto» es local de la pantalla y `<Activity>` lo conserva: al volver con «adelante» el
// efecto de `useModalDialog` se recrea y `showModal()` reabre el diálogo que estaba abierto al salir (visto con `next start`; con
// `next dev` no ocurre). El diseño (D15) pide que no se recupere nada de la visita anterior.
test.fail('QA-5 (defecto conocido): al volver con «adelante» no reaparece ningún diálogo abierto al salir', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  const reappeared: string[] = [];
  for (const [label, open] of dialogOpeners(page)) {
    await enterEditor(page);
    await open();
    await page.goBack();
    await expect(page).toHaveURL(/\/flujos$/);
    await page.goForward();
    await page.locator('#editor-title').waitFor();
    await page.waitForTimeout(500);
    if ((await page.locator('dialog[open]').count()) > 0) reappeared.push(label);
  }
  expect(reappeared).toEqual([]);
});

test('Con cambios sin guardar, tras salir por «Salir» recargar la lista no pregunta', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await inspector(page).getByLabel('Nombre', { exact: true }).fill('Otro');
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  await screen(page).getByRole('navigation').getByRole('link', { name: 'Flujos', exact: true }).click();
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(page).toHaveURL(/\/flujos$/);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.reload();
  expect(dialogs).toEqual([]);
});

// QA-2: tras «Guardar encima» el aviso de conflicto (con el botón pulsado) se quita del DOM y el foco cae a la página. La spec
// («El foco no se pierde en el editor») pide que tras guardar, publicar o un error el foco quede en un elemento con sentido.
test.fail('QA-2 (defecto conocido): el foco no cae a la página tras «Guardar encima»', async ({ page, admin, context }) => {
  await admin.createDraft('captacion-leads');
  const other = await context.newPage();
  await openEditor(page, 'captacion-leads');
  await openEditor(other, 'captacion-leads');
  await inspector(other).getByLabel('Nombre', { exact: true }).fill('B');
  await save(other);
  await expect(screen(other).getByText('Guardado. Revisión 2.')).toBeVisible();
  await inspector(page).getByLabel('Nombre', { exact: true }).fill('A');
  await save(page);
  await screen(page).getByRole('button', { name: 'Guardar encima' }).click();
  await expect(screen(page).getByText('Guardado. Revisión 3.')).toBeVisible();
  expect(await focused(page)).not.toBe('BODY');
});

// QA-3: «Quitar cabecera» (y los «Quitar» de las listas) quitan del DOM el botón que tenía el foco y este cae a la página.
test.fail('QA-3 (defecto conocido): el foco no cae a la página al quitar una cabecera', async ({ page, admin }) => {
  await admin.createDraft('captacion-leads');
  await openEditor(page, 'captacion-leads');
  await node(page, 'enviar-crm').click();
  await inspector(page).getByRole('button', { name: /Quitar la cabecera/ }).first().click();
  await expect(dirty(page)).toBeVisible();
  expect(await focused(page)).not.toBe('BODY');
});

// QA-4: la región de estado conserva «Guardado. Revisión N.» de un guardado anterior mientras se ve el aviso de conflicto de uno
// posterior: la pantalla dice a la vez que se guardó y que no.
test.fail('QA-4 (defecto conocido): un guardado que da 412 no deja visible «Guardado. Revisión N.» de otro anterior', async ({ page, admin, context }) => {
  await admin.createDraft('captacion-leads');
  const other = await context.newPage();
  await openEditor(page, 'captacion-leads');
  await openEditor(other, 'captacion-leads');
  await inspector(page).getByLabel('Nombre', { exact: true }).fill('A');
  await save(page);
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toBeVisible();
  await inspector(other).getByLabel('Nombre', { exact: true }).fill('B');
  await save(other);
  await inspector(page).getByLabel('Nombre', { exact: true }).fill('A2');
  await save(page);
  await expect(screen(page).getByText('Otra pestaña', { exact: false }).or(screen(page).getByRole('button', { name: 'Cargar el guardado' }))).toBeVisible();
  await expect(screen(page).getByText('Guardado. Revisión 2.')).toHaveCount(0);
});

test.describe('crear desde JSON pegado', () => {
  const FLOW = (id: string, extra: Json = {}): Json => ({ specVersion: '0.1', id, name: 'Pegado', start: 'fin', nodes: [{ id: 'fin', type: 'end' }], ...extra });

  /** Un flujo válido cuyo texto compacto mide exactamente `bytes` bytes (mensajes de 1500 letras y un relleno en el último). */
  function flowOfBytes(id: string, bytes: number): Json {
    const nodes: Json[] = [];
    const flow = { specVersion: '0.1', id, name: 'Grande', start: 'n0', nodes };
    while (Buffer.byteLength(JSON.stringify(flow)) < bytes - 3000) {
      const index = nodes.length;
      nodes.push({ id: `n${index}`, type: 'message', content: [{ kind: 'text', text: 'a'.repeat(1500) }], next: `n${index + 1}` });
    }
    nodes.push({ id: `n${nodes.length}`, type: 'end' });
    const padding = bytes - Buffer.byteLength(JSON.stringify(flow));
    ((nodes[nodes.length - 2]!.content as Json[])[0] as Json).text += 'b'.repeat(padding);
    return flow;
  }

  async function paste(page: Page, text: string): Promise<void> {
    await page.goto('/flujos');
    await page.getByRole('button', { name: 'Nuevo flujo', exact: true }).click();
    await page.getByLabel('Desde JSON').check();
    await page.getByLabel('JSON del flujo').fill(text);
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
  }

  test('formas que no son un flujo: el diálogo lo dice, sin [object Object] y sin tocar la API', async ({ page, stack }) => {
    const cases: [string, string, RegExp][] = [
      ['lista', '[]', /debe ser de tipo object/],
      ['null', 'null', /debe ser de tipo object/],
      ['número', '5', /debe ser de tipo object/],
      ['BOM', `﻿${JSON.stringify(FLOW('bom'))}`, /El texto no es JSON/],
      ['nodes objeto', JSON.stringify(FLOW('a', { nodes: { a: 1 } })), /debe ser de tipo array \(\/nodes\)/],
      ['nodo nulo', JSON.stringify(FLOW('a', { nodes: [null] })), /\/nodes\/0/],
      ['id de nodo numérico', JSON.stringify(FLOW('a', { nodes: [{ id: 5, type: 'end' }], start: 5 })), /\/nodes\/0\/id/],
      ['type constructor', JSON.stringify(FLOW('a', { nodes: [{ id: 'fin', type: 'constructor' }] })), /tipo de nodo desconocido: "constructor"/],
      ['type __proto__', JSON.stringify(FLOW('a', { nodes: [{ id: 'fin', type: '__proto__' }] })), /tipo de nodo desconocido: "__proto__"/],
      ['clave __proto__', `{"__proto__":{"a":1},"specVersion":"0.1","id":"a","name":"x","start":"fin","nodes":[{"id":"fin","type":"end"}]}`, /propiedad no permitida '__proto__'/],
      ['posición con texto', JSON.stringify(FLOW('a', { nodes: [{ id: 'fin', type: 'end', position: { x: 'a', y: 'b' } }] })), /\/nodes\/0\/position\/x/],
      ['posición Infinity', '{"specVersion":"0.1","id":"a","name":"x","start":"fin","nodes":[{"id":"fin","type":"end","position":{"x":1e400,"y":0}}]}', /\/nodes\/0\/position\/x/],
      ['100 000 niveles', `${JSON.stringify(FLOW('a')).slice(0, -1)},"x":${'['.repeat(100_000)}${']'.repeat(100_000)}}`, /profundidad máxima de anidamiento \(1000\)/],
      ['mayúsculas en el id', JSON.stringify(FLOW('Mayus')), /no cumple el patrón/],
    ];
    for (const [label, text, expected] of cases) {
      await paste(page, text);
      const dialog = page.locator('dialog[open]');
      await expect(dialog, label).toContainText(expected);
      expect(await dialog.innerText(), label).not.toContain('[object Object]');
    }
    expect(countRequests(stack, 'POST', '/flows')).toBe(0);
  });

  test('el tope de 1 MiB: 1 048 576 bytes se crean y 1 048 577 no', async ({ page, admin }) => {
    const exact = flowOfBytes('limite-ok', 1_048_576);
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(1_048_576);
    await paste(page, JSON.stringify(exact));
    await page.waitForURL(/\/flujos\/limite-ok$/);
    expect(JSON.stringify((await admin.flow('limite-ok')).flow)).toBe(JSON.stringify(exact));
    const over = flowOfBytes('limite-ko', 1_048_577);
    expect(Buffer.byteLength(JSON.stringify(over))).toBe(1_048_577);
    await paste(page, JSON.stringify(over));
    await expect(page.locator('dialog[open]')).toContainText('El flujo supera el tamaño máximo de 1 MiB.');
    expect((await admin.call('GET', '/flows/limite-ko')).status).toBe(404);
  });

  test('el espacio en blanco no cuenta: un flujo pequeño con 2 MiB de formato se crea', async ({ page, admin }) => {
    await paste(page, `${JSON.stringify(FLOW('blancos'))}${' '.repeat(2 * 1_048_576)}`);
    await page.waitForURL(/\/flujos\/blancos$/);
    expect((await admin.flow('blancos')).flow).toEqual(FLOW('blancos'));
  });
});

test('Probar usa la versión publicada y no el borrador con cambios sin publicar', async ({ page, admin }) => {
  await admin.publish(FLOWS.hola as Json);
  await admin.updateDraft({ ...(FLOWS.hola as Json), name: 'Hola borrador' });
  await openEditor(page, 'hola');
  await expect(screen(page).getByText('Se probará la versión 1, no el borrador.')).toBeVisible();
  await screen(page).getByRole('button', { name: 'Probar', exact: true }).click();
  await page.waitForURL(/\/conversaciones\//);
  const id = page.url().split('/').pop()!;
  const conversation = (await admin.call('GET', `/conversations/${id}`)).body as Json;
  expect([conversation.flowId, conversation.version]).toEqual(['hola', 1]);
});
