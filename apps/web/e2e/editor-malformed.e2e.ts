import type { Page } from '@playwright/test';
import type { Stack } from './support/stack';
import { node, openEditor, screen } from './support/editor';
import { expect, test } from './support/test';

// QA independiente (web-editor, 2026-10-18): D25 en el navegador. La API simulada devuelve, para `GET /flows/malformado`, flujos
// con formas que la API real no guardaría (los valida al crear) pero que el editor tiene que aguantar sin pantalla de error,
// sin excepciones ni `console.error` (el `page` del fixture falla si hay alguno) y sin pintar `[object Object]`.

const T = (text: string) => [{ kind: 'text', text }];
const END = { id: 'fin', type: 'end' };
const msg = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'message', content: T('hola'), next: 'fin', ...extra });
const flow = (nodes: unknown, extra: Record<string, unknown> = {}) => ({ specVersion: '0.1', id: 'malformado', name: 'Malformado', start: 'a', nodes, ...extra });
const deep = (levels: number) => '['.repeat(levels) + '"x"' + ']'.repeat(levels);

/** El recurso que devolvería la API con ese texto de flujo (el texto se inserta tal cual, para poder escribir `1e400`). */
function resource(flowJson: string): string {
  return `{"id":"malformado","name":"Malformado","revision":1,"latestVersion":null,"unpublishedChanges":true,"createdAt":"2026-10-18T06:57:40.698Z","updatedAt":"2026-10-18T06:57:40.698Z","flow":${flowJson},"warnings":[]}`;
}

function serve(stack: Stack, flowJson: string): void {
  stack.fakeApi.respond((request, response) => {
    if (request.method === 'GET' && request.path === '/flows/malformado') {
      const text = resource(flowJson);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(text)) });
      response.end(text);
      return;
    }
    const text = '{"message":"x","error":"not_found"}';
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(text)) });
    response.end(text);
  });
}

/** Recorre lo que una persona haría: seleccionar cada nodo, abrir «Ver JSON» y «Editar como JSON», y pulsar «Guardar». */
async function exercise(page: Page): Promise<void> {
  const ids = await screen(page)
    .locator('[data-node-id]')
    .evaluateAll((elements) => elements.slice(0, 8).map((element) => element.getAttribute('data-node-id') ?? ''));
  for (const id of ids) await node(page, id).click();
  await screen(page).getByRole('button', { name: 'Ver JSON' }).click();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  if (ids.length > 0) {
    await node(page, ids[0]!).click();
    await screen(page).getByRole('button', { name: /Editar como JSON/ }).click();
    await page.keyboard.press('Escape');
  }
  await screen(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('[object Object]');
  expect(text).not.toContain('NaN');
}

const BAD_NODES: [string, unknown][] = [
  ['start que no existe', flow([END], { start: 'zz' })],
  ['start __proto__', flow([END], { start: '__proto__' })],
  ['id __proto__ y constructor', flow([msg('__proto__', { next: 'constructor' }), msg('constructor', { next: '__proto__' }), END], { start: '__proto__' })],
  ['next objeto, lista y número', flow([msg('a', { next: {} }), msg('b', { next: [] }), msg('c', { next: 5 }), msg('d', { next: '__proto__' }), END])],
  ['content de otro tipo', flow([msg('a', { content: 'x' }), msg('b', { content: [null, 5, { kind: 5 }, { kind: 'text', text: {} }] }), END])],
  ['title objeto y lista', flow([msg('a', { title: { a: 1 } }), msg('b', { title: [1, [2]] }), END])],
  ['title con controles, RTL, NUL y sustituto suelto', flow([msg('a', { title: '‮\n\r\t\u0000\ud800' + '😀'.repeat(50) }), END])],
  ['title de 1 MB', flow([msg('a', { title: 'T'.repeat(1_000_000) }), END])],
  ['title sin espacios de 5000 letras', flow([msg('a', { title: 'W'.repeat(5000) }), END])],
  ['type null, número y objeto', flow([{ id: 'a', type: null }, { id: 'b', type: 5 }, { id: 'c', type: {} }, END])],
  ['position con texto, null, lista, número y vacío', flow([msg('a', { position: { x: 'a', y: 'b' } }), msg('b', { position: null }), msg('c', { position: [1, 2] }), msg('d', { position: 5 }), msg('e', { position: {} }), END])],
  ['position negativa enorme pero segura', flow([msg('a', { position: { x: -1e15, y: 1e15 } }), END])],
  ['choices de otro tipo', flow([{ id: 'a', type: 'input', inputType: 'choice', variable: 'v', prompt: T('?'), choices: 'x' }, { id: 'b', type: 'input', inputType: 'choice', variable: 'w', prompt: T('?'), choices: [null, 5, 'x', { id: {}, label: {}, next: {} }] }, END])],
  ['choices con ids de prototipo', flow([{ id: 'a', type: 'input', inputType: 'choice', variable: 'v', prompt: T('?'), choices: [{ id: '__proto__', label: 'L', next: 'fin' }, { id: 'constructor', label: 'M', next: 'fin' }], next: 'fin' }, END])],
  ['rules de otro tipo', flow([{ id: 'a', type: 'condition', rules: [null], else: 'fin' }, { id: 'b', type: 'condition', rules: 5, else: 'fin' }, { id: 'c', type: 'condition', rules: [{ when: 'x', next: {} }], else: {} }, END])],
  ['set con assignments de otro tipo', flow([{ id: 'a', type: 'set', assignments: {}, next: 'fin' }, { id: 'b', type: 'set', assignments: [null, { variable: {}, value: {} }], next: 'fin' }, END])],
  ['http con request y headers de otro tipo', flow([{ id: 'a', type: 'http', request: 'x', next: 'fin' }, { id: 'b', type: 'http', request: { method: 'GET', url: 'https://e.com', headers: [1] }, next: 'fin' }, END])],
  ['http con claves de prototipo en headers', flow([{ id: 'a', type: 'http', request: JSON.parse('{"method":"GET","url":"https://e.com","headers":{"__proto__":"x","constructor":{"secret":"A"},"a/b":5,"-":null,"10":[]}}'), next: 'fin', onError: 'fin' }, END])],
  ['http con body anidado 900 niveles', flow([{ id: 'a', type: 'http', request: { method: 'POST', url: 'https://e.com', body: JSON.parse(deep(900)) }, next: 'fin' }, END])],
  ['llm y jump de otro tipo', flow([{ id: 'a', type: 'llm', provider: 5, tools: 'x', next: {} }, { id: 'b', type: 'jump', target: {} }, { id: 'c', type: 'jump', target: 'c' }, END])],
  ['variables, settings, locale y description de otro tipo', flow([END], { start: 'fin', variables: [null, { name: {} }], settings: 5, locale: {}, description: { a: 1 } })],
  ['variables objeto', flow([END], { start: 'fin', variables: {} })],
  ['5000 nodos', flow(Array.from({ length: 5000 }, (_, index) => msg(`n${index}`, { next: `n${(index + 1) % 5000}` })), { start: 'n0' })],
];

test.describe('flujos con formas que la API real no guardaría', () => {
  for (const [label, value] of BAD_NODES) {
    test(label, async ({ page, stack }) => {
      serve(stack, JSON.stringify(value));
      await openEditor(page, 'malformado');
      await exercise(page);
    });
  }

  test('1500 niveles de anidamiento en un nodo: la API no los guarda y el editor los rechaza al abrir', async ({ page, stack }) => {
    serve(stack, JSON.stringify(flow([msg('a', { x: JSON.parse(deep(1500)) }), END])));
    await page.goto('/flujos/malformado');
    await expect(screen(page).getByRole('heading', { name: 'No se ha podido abrir el flujo' })).toBeVisible();
  });

  test('ids de nodo repetidos en un flujo servido: se rechaza al abrir, sin avisos de key', async ({ page, stack }) => {
    serve(stack, JSON.stringify(flow([msg('a'), msg('a'), END])));
    await page.goto('/flujos/malformado');
    await expect(screen(page).getByRole('heading', { name: 'No se ha podido abrir el flujo' })).toBeVisible();
  });

  test('type de prototipo: validateFlow lanza con ellos y el editor da el veredicto de tipo desconocido', async ({ page, stack }) => {
    serve(stack, JSON.stringify(flow([{ id: 'a', type: 'constructor' }, { id: 'b', type: '__proto__' }, { id: 'c', type: 'toString' }, END], { start: 'fin' })));
    await openEditor(page, 'malformado');
    await expect(screen(page).locator('section[aria-labelledby="problems-title"]')).toContainText('tipo de nodo desconocido');
    await exercise(page);
  });

  test('position con 1e400 (Infinity tras JSON.parse) se coloca con el diseño automático y no rompe nada', async ({ page, stack }) => {
    serve(stack, '{"specVersion":"0.1","id":"malformado","name":"M","start":"a","nodes":[{"id":"a","type":"message","content":[{"kind":"text","text":"x"}],"next":"fin","position":{"x":1e400,"y":-1e400}},{"id":"fin","type":"end"}]}');
    await openEditor(page, 'malformado');
    await exercise(page);
    await expect(screen(page).locator('[data-edge-from="a"]')).toHaveCount(1);
  });

  test('la clave __proto__ en la raíz del flujo no contamina nada', async ({ page, stack }) => {
    serve(stack, '{"__proto__":{"polluted":1},"specVersion":"0.1","id":"malformado","name":"M","start":"fin","nodes":[{"id":"fin","type":"end"}]}');
    await openEditor(page, 'malformado');
    await exercise(page);
    expect(await page.evaluate(() => ({}).hasOwnProperty.call({}, 'polluted') || ('polluted' in {}))).toBe(false);
  });

  test('lo que readFlowResource rechaza es una pantalla de error con «Reintentar», no un editor roto', async ({ page, stack }) => {
    const rejected = [
      '{"specVersion":"0.1","id":"malformado","name":"M","start":"a","nodes":{"a":{}}}',
      '{"specVersion":"0.1","id":"malformado","name":"M","start":"a","nodes":null}',
      '{"specVersion":"0.1","id":"malformado","name":"M","start":"a","nodes":[null]}',
      '{"specVersion":"0.1","id":"malformado","name":"M","start":"a","nodes":[5]}',
      '{"specVersion":"0.1","id":"malformado","name":"M","start":"a","nodes":[{"id":{},"type":"end"}]}',
      '{"specVersion":"0.1","id":"malformado","name":"M","start":{},"nodes":[{"id":"a","type":"end"}]}',
      '[]',
      'null',
      '5',
    ];
    for (const text of rejected) {
      serve(stack, text);
      await page.goto('/flujos/malformado');
      await expect(screen(page).getByRole('heading', { name: 'No se ha podido abrir el flujo' }), text).toBeVisible();
      await expect(screen(page).getByRole('button', { name: 'Reintentar' })).toBeVisible();
      await expect(screen(page).getByRole('link', { name: 'Volver a los flujos' })).toBeVisible();
      expect(await page.locator('body').innerText()).not.toContain('[object Object]');
    }
  });

  // QA-1 (E2E): con una posición finita pero enorme el SVG del lienzo recibe `1e+308` y Chromium escribe `console.error`.
  test('QA-1: una posición de 1e308 no ensucia la consola ni rompe las conexiones', async ({ page, stack }) => {
    serve(stack, '{"specVersion":"0.1","id":"malformado","name":"M","start":"a","nodes":[{"id":"a","type":"message","content":[{"kind":"text","text":"x"}],"next":"fin","position":{"x":1e308,"y":-1e308}},{"id":"fin","type":"end","position":{"x":0,"y":0}}]}');
    await openEditor(page, 'malformado');
    const viewBox = await screen(page).locator('#flow-canvas svg').first().getAttribute('viewBox');
    expect(viewBox).not.toMatch(/\d[eE][+-]?\d/);
  });

  // QA-6: `EditorScreen` serializa el nodo seleccionado con `JSON.stringify(selectedNode, null, 2)` en cada render, fuera de
  // `flowText`; con ~5000 niveles lanza `RangeError` y toda la pantalla pasa al límite de error. Solo con un flujo que la API
  // real no admite (más de 1000 niveles), pero `readFlowResource` no lo comprueba.
  test('QA-6: un flujo servido con 5000 niveles se rechaza al abrir, sin tumbar la pantalla', async ({ page, stack }) => {
    serve(stack, `{"specVersion":"0.1","id":"malformado","name":"M","start":"a","nodes":[{"id":"a","type":"message","content":[{"kind":"text","text":"x"}],"next":"a","x":${deep(5000)}}]}`);
    await page.goto('/flujos/malformado');
    await expect(screen(page).getByRole('heading', { name: 'No se ha podido abrir el flujo' })).toBeVisible();
    await expect(page.getByText('Algo ha fallado')).toHaveCount(0);
  });
});
