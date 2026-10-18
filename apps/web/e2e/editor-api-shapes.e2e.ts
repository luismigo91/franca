import { FLOW_BODY, FLOW_UPDATED_BODY, INVALID_FLOW_BODY, LIST_BODY, LITERAL_CREDENTIAL_BODY, NOT_FOUND_BODY, PRECONDITION_REQUIRED_BODY, REVISION_MISMATCH_BODY, VERSION_BODY } from '../tests/helpers/real-flow-shapes';
import { expect, test } from './support/test';

// Las claves y el orden de las respuestas copiadas en `tests/helpers/real-flow-shapes.ts` tienen que coincidir con los de la
// API real (lecciones-equipo: los dobles se copian de la forma real).

type Json = Record<string, unknown>;
const keys = (value: unknown) => Object.keys(value as Json);
const shape = (text: string) => JSON.parse(text) as Json;

test('Formas de la API de flujos frente a las copiadas', async ({ stack }) => {
  const base = stack.realApiUrl;
  const call = async (method: string, path: string, body?: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: (text === '' ? null : JSON.parse(text)) as Json | null };
  };
  const hola = JSON.stringify(shape(FLOW_BODY).flow);

  const created = await call('POST', '/flows', hola);
  expect(created.status).toBe(201);
  expect(keys(created.body)).toEqual(keys(shape(FLOW_BODY)));
  expect(keys(created.body!.flow)).toEqual(keys(shape(FLOW_BODY).flow));
  expect(created.headers.get('etag')).toBe('"1"');
  expect(created.headers.get('location')).toBe('/flows/hola');

  const read = await call('GET', '/flows/hola');
  expect(keys(read.body)).toEqual(keys(shape(FLOW_BODY)));
  expect(read.body!.latestVersion).toBeNull();

  const list = await call('GET', '/flows?limit=20&offset=0');
  expect(keys(list.body)).toEqual(keys(shape(LIST_BODY)));
  expect(keys((list.body!.items as Json[])[0])).toEqual(keys((shape(LIST_BODY).items as Json[])[0]));

  const saved = await call('PUT', '/flows/hola', JSON.stringify({ ...(shape(FLOW_BODY).flow as Json), name: 'Hola 2' }), { 'If-Match': '"1"' });
  expect(saved.status).toBe(200);
  expect(keys(saved.body)).toEqual(keys(shape(FLOW_UPDATED_BODY)));
  expect(saved.headers.get('etag')).toBe('"2"');

  const mismatch = await call('PUT', '/flows/hola', hola, { 'If-Match': '"1"' });
  expect(mismatch.status).toBe(412);
  expect(keys(mismatch.body)).toEqual(keys(shape(REVISION_MISMATCH_BODY)));
  expect(mismatch.body!.currentRevision).toBe(2);

  const missing = await call('PUT', '/flows/hola', hola);
  expect(missing.status).toBe(428);
  expect(keys(missing.body)).toEqual(keys(shape(PRECONDITION_REQUIRED_BODY)));

  const first = await call('POST', '/flows/hola/versions', undefined, { 'If-Match': '"2"' });
  expect(first.status).toBe(201);
  expect(keys(first.body)).toEqual(keys(shape(VERSION_BODY)));
  expect(first.headers.get('location')).toBe('/flows/hola/versions/1');
  const again = await call('POST', '/flows/hola/versions', undefined, { 'If-Match': '"2"' });
  expect(again.status).toBe(200);
  expect(keys(again.body)).toEqual(keys(shape(VERSION_BODY)));

  const invalid = await call('POST', '/flows', '{"specVersion":"0.1","id":"x","name":"","start":"a","nodes":[]}');
  expect(invalid.status).toBe(400);
  expect(keys(invalid.body)).toEqual(keys(shape(INVALID_FLOW_BODY)));
  expect(keys((invalid.body!.issues as Json[])[0])).toEqual(keys((shape(INVALID_FLOW_BODY).issues as Json[])[0]));

  const literal = await call(
    'POST',
    '/flows',
    JSON.stringify({ specVersion: '0.1', id: 'cred', name: 'C', start: 'h', nodes: [{ id: 'h', type: 'http', request: { method: 'GET', url: 'https://x.example/a', headers: { Authorization: 'Bearer abc123' } }, next: 'f', onError: 'f' }, { id: 'f', type: 'end' }] }),
  );
  expect(literal.status).toBe(400);
  expect(keys(literal.body)).toEqual(keys(shape(LITERAL_CREDENTIAL_BODY)));
  expect(keys((literal.body!.warnings as Json[])[0])).toEqual(keys((shape(LITERAL_CREDENTIAL_BODY).warnings as Json[])[0]));

  const gone = await call('GET', '/flows/no-existe');
  expect(gone.status).toBe(404);
  expect(keys(gone.body)).toEqual(keys(shape(NOT_FOUND_BODY)));

  const deleted = await call('DELETE', '/flows/hola', undefined, { 'If-Match': '"2"' });
  expect(deleted.status).toBe(204);
  expect(deleted.text).toBe('');
  expect(deleted.headers.get('content-length')).toBeNull();
});
