import http from 'node:http';
import type { Locator, Page } from '@playwright/test';
import type { RecordedRequest } from '../../tests/helpers/fake-api';
import type { Stack } from './stack';

/** Abre `/flujos/<id>` y espera a que el editor termine de leer. */
export async function openEditor(page: Page, flowId: string): Promise<void> {
  await page.goto(`/flujos/${flowId}`);
  await page.locator('#editor-title').waitFor();
}

/** La pantalla visible del editor (las rutas ocultas por `<Activity>` siguen en el DOM). */
export const screen = (page: Page): Locator => page.locator('main').filter({ visible: true });

/** Un nodo del lienzo por su `id`. */
export const node = (page: Page, id: string): Locator => screen(page).locator(`[data-node-id="${id}"]`);

/** El inspector (o el panel del flujo) visible. */
export const inspector = (page: Page): Locator => screen(page).locator('section[aria-labelledby="inspector-title"]');

/** La lista de problemas visible. */
export const problems = (page: Page): Locator => screen(page).locator('section[aria-labelledby="problems-title"]');

export interface EdgeInfo {
  from: string;
  key: string;
  pointer: string;
  to: string;
  broken: boolean;
}

/** Las conexiones que dibuja el lienzo, leídas de `data-edge-*`. */
export async function edges(page: Page): Promise<EdgeInfo[]> {
  return screen(page)
    .locator('[data-edge-from]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        from: element.getAttribute('data-edge-from') ?? '',
        key: element.getAttribute('data-edge-key') ?? '',
        pointer: element.getAttribute('data-edge-pointer') ?? '',
        to: element.getAttribute('data-edge-to') ?? '',
        broken: element.getAttribute('data-broken') === 'true',
      })),
    );
}

/** Ensancha la ventana y reduce el lienzo para que quepa todo en la zona visible (el arrastre necesita ver origen y destino). */
export async function fitCanvas(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1000 });
  for (let step = 0; step < 3; step++) await screen(page).getByRole('button', { name: 'Reducir' }).click();
}

export type DropTarget = string | 'vacío' | 'fuera' | 'escape';

/**
 * Arrastra una salida con el ratón (`down`, `move` en 8 pasos, `up`): hasta un nodo, hasta una zona vacía del lienzo, fuera
 * del lienzo o hasta un nodo con Escape antes de soltar. Todos los nodos tienen que estar en la zona visible (`fitCanvas`).
 */
export async function dragOutput(page: Page, from: string, key: string, destination: DropTarget, to?: string): Promise<void> {
  const output = node(page, from).locator(`[data-output="${key}"]`);
  const source = (await output.boundingBox())!;
  const zone = (await page.locator('#flow-canvas').filter({ visible: true }).boundingBox())!;
  let target: { x: number; y: number };
  if (destination === 'vacío') target = { x: zone.x + zone.width - 30, y: zone.y + zone.height - 30 };
  else if (destination === 'fuera') target = { x: zone.x + zone.width / 2, y: 4 };
  else {
    const box = (await node(page, destination === 'escape' ? to! : destination).boundingBox())!;
    target = { x: box.x + box.width / 2, y: box.y + 20 };
  }
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  if (destination === 'escape') await page.keyboard.press('Escape');
  await page.mouse.up();
}

/** La última petición de la API simulada con ese método y esa ruta (o `undefined`). */
export function lastRequest(stack: Stack, method: string, path: string | RegExp): RecordedRequest | undefined {
  return [...stack.fakeApi.requests].reverse().find((request) => request.method === method && (typeof path === 'string' ? request.path === path : path.test(request.path)));
}

/** El cuerpo JSON de una petición registrada. */
export function bodyOf(request: RecordedRequest | undefined): Record<string, unknown> {
  return JSON.parse(request?.body ?? 'null') as Record<string, unknown>;
}

/** Cuántas peticiones de la API simulada tienen ese método y esa ruta. */
export function countRequests(stack: Stack, method: string, path: string | RegExp): number {
  return stack.fakeApi.requests.filter((request) => request.method === method && (typeof path === 'string' ? request.path === path : path.test(request.path))).length;
}

/** Reenvía una petición a la API real con `node:http` y devuelve su respuesta. */
function forwardToReal(stack: Stack, request: RecordedRequest): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const real = new URL(stack.realApiUrl);
  const headers: Record<string, string> = { Host: real.host, Connection: 'close' };
  for (const name of ['content-type', 'if-match']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  if (request.body !== '') headers['content-length'] = String(Buffer.byteLength(request.body));
  return new Promise((resolve, reject) => {
    const upstream = http.request({ host: real.hostname, port: Number(real.port), method: request.method, path: request.path, headers }, (answer) => {
      const chunks: Buffer[] = [];
      answer.on('data', (chunk: Buffer) => chunks.push(chunk));
      answer.on('end', () => resolve({ status: answer.statusCode ?? 502, headers: answer.headers, body: Buffer.concat(chunks) }));
    });
    upstream.on('error', reject);
    upstream.end(request.body === '' ? undefined : request.body);
  });
}

/**
 * Un guion de la API simulada: reenvía a la API real, y para la petición que cumple `cut` la reenvía (la API real la aplica)
 * y corta la conexión con el servidor de la web sin responderle. Es la «respuesta perdida».
 */
export function forwardThenCut(stack: Stack, cut: (request: RecordedRequest) => boolean = (request) => request.method === 'PUT'): void {
  stack.fakeApi.respond(async (request, response, socket) => {
    const answer = await forwardToReal(stack, request);
    if (cut(request)) {
      socket.destroy();
      return;
    }
    const out: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(answer.headers)) {
      if (value !== undefined && !['connection', 'transfer-encoding', 'keep-alive', 'date'].includes(name)) out[name] = value;
    }
    response.writeHead(answer.status, out);
    response.end(answer.body);
  });
}
