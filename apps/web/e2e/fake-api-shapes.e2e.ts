import http from 'node:http';
import { RAW_204 } from '../tests/helpers/real-api-shapes';
import { flowItem, messageEvent, resourceOf, textInputEvent, userItem } from './support/api-shapes';
import { expect, test } from './support/test';

// Las claves y el orden de los recursos simulados tienen que coincidir con los de la API real (lecciones-equipo:
// los dobles se copian de la forma real). Lo medido aquí se copia en `tests/helpers/real-api-shapes.ts`.

type Json = Record<string, unknown>;
const keys = (value: unknown) => Object.keys(value as Json);

test('Formas de la API simulada frente a la real', async ({ admin, stack }) => {
  await admin.publish('pregunta');
  const base = stack.realApiUrl;
  const json = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as Json | null };
  };

  const created = await json('POST', '/conversations', { flowId: 'pregunta' });
  expect(created.status).toBe(201);
  const real = created.body!;
  expect(keys(real)).toEqual(['conversation', 'events']);
  expect(keys(real.conversation)).toEqual(keys(resourceOf()));
  const events = real.events as Json[];
  expect(keys(events[0])).toEqual(keys(messageEvent('p', 'x')));
  expect(keys(events[1])).toEqual(keys(textInputEvent('p')));

  const id = (real.conversation as Json).id as string;
  const resource = await json('GET', `/conversations/${id}`);
  expect(keys(resource.body)).toEqual(keys(resourceOf()));

  const answered = await json('POST', `/conversations/${id}/inputs`, { input: { text: 'Ana' } }, { 'If-Match': '"1"' });
  expect(answered.status).toBe(200);
  expect(keys(answered.body)).toEqual(['conversation', 'events']);

  const transcript = await json('GET', `/conversations/${id}/transcript?limit=100`);
  expect(keys(transcript.body)).toEqual(keys({ items: [], total: 0, limit: 100, offset: 0 }));
  const items = (transcript.body as Json).items as Json[];
  expect(keys(items.find((item) => item.role === 'flow'))).toEqual(keys(flowItem(1, {})));
  expect(keys(items.find((item) => item.role === 'user'))).toEqual(keys(userItem(1, {})));

  const list = await json('GET', '/conversations?limit=20');
  expect(keys(list.body)).toEqual(['items', 'total', 'limit', 'offset']);
  const { pendingInput: _pending, ...summaryKeys } = resourceOf() as unknown as Json;
  void _pending;
  expect(keys(((list.body as Json).items as Json[])[0])).toEqual(Object.keys(summaryKeys));

  const flows = await json('GET', '/flows?published=true&limit=20');
  expect(keys(flows.body)).toEqual(['items', 'total', 'limit', 'offset']);
  expect(keys(((flows.body as Json).items as Json[])[0])).toEqual(['id', 'name', 'revision', 'latestVersion', 'unpublishedChanges', 'createdAt', 'updatedAt']);

  const version = await json('GET', '/flows/pregunta/versions/1');
  expect(keys(version.body)).toEqual(['flowId', 'version', 'name', 'publishedAt', 'flow', 'warnings']);

  const second = await json('POST', '/conversations', { flowId: 'pregunta' });
  const secondId = ((second.body as Json).conversation as Json).id as string;
  const mismatch = await json('POST', `/conversations/${secondId}/inputs`, { input: { text: 'x' } }, { 'If-Match': '"9"' });
  expect(mismatch.status).toBe(412);
  expect(keys(mismatch.body)).toEqual(['message', 'error', 'currentRevision']);
  expect(mismatch.body!.error).toBe('revision_mismatch');

  // El 204 de DELETE: estado, cabeceras y cuerpo vacío de la API real frente a la copia de `real-api-shapes.ts`.
  const real204 = await new Promise<{ status: number; headers: string[]; body: string }>((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: new URL(base).port, method: 'DELETE', path: `/conversations/${secondId}`, headers: { Host: new URL(base).host, Connection: 'close' } }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.rawHeaders.filter((_, index) => index % 2 === 0), body }));
    });
    request.on('error', reject);
    request.end();
  });
  expect(real204.status).toBe(204);
  expect(real204.body).toBe('');
  const copied = RAW_204.toString('utf8').split('\r\n\r\n')[0]!.split('\r\n');
  expect(copied[0]).toBe('HTTP/1.1 204 No Content');
  expect(real204.headers).toEqual(copied.slice(1).map((line) => line.split(':')[0]));
});
