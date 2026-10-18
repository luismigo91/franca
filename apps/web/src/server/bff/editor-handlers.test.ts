import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCreateFlow, handleDeleteFlow, handleGetFlow, handleListEditorFlows, handlePublishFlow, handleUpdateFlow } from '@/server/bff/handlers';
import { withFakeApi } from '../../../tests/helpers/api-env';
import { sendJson } from '../../../tests/helpers/fake-api';
import {
  FLOW_BODY,
  FLOW_UPDATED_BODY,
  INVALID_FLOW_BODY,
  LIST_BODY,
  RAW_400_INVALID_FLOW,
  RAW_400_LITERAL,
  RAW_404,
  RAW_409_EXISTS,
  RAW_409_RESERVED,
  RAW_412,
  RAW_DELETE_204,
  RAW_FLOW_200,
  RAW_FLOW_201,
  RAW_LIST_200,
  RAW_PUT_200,
  RAW_VERSION_200,
  RAW_VERSION_201,
  REVISION_MISMATCH_BODY,
  VERSION_BODY,
} from '../../../tests/helpers/real-flow-shapes';
import { startRawApi } from '../../../tests/helpers/real-api-shapes';

const BASE = 'http://localhost:3000';
const ORIGIN_HEADERS = { Host: 'localhost:3000', Origin: BASE };
const HOLA = '{"specVersion":"0.1","id":"hola","name":"Hola","start":"fin","nodes":[{"id":"fin","type":"end"}]}';
const fake = withFakeApi();

const send = (method: string, path: string, body?: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method, ...(body === undefined ? {} : { body }), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...ORIGIN_HEADERS, ...headers } });
const get = (path: string) => new Request(`${BASE}${path}`);
const params = { flowId: 'hola' };

afterEach(() => vi.restoreAllMocks());

/** Una petición cuyo cuerpo no se puede leer: si el manejador lo lee, el test falla. */
function unreadable(method: string, path: string, headers: Record<string, string> = {}): Request {
  const request = new Request(`${BASE}${path}`, { method, headers: { ...ORIGIN_HEADERS, ...headers } });
  const boom = () => {
    throw new Error('el cuerpo se ha leído');
  };
  Object.defineProperty(request, 'body', { get: boom });
  for (const name of ['text', 'json', 'arrayBuffer', 'blob', 'formData'] as const) Object.defineProperty(request, name, { value: boom });
  return request;
}

const lines = () => fake.api.requests.map((request) => `${request.method} ${request.path}`);

describe('las seis operaciones del editor: método, ruta, consulta, cabeceras y bytes exactos', () => {
  it('la lista no lleva published y el navegador no elige limit', async () => {
    fake.api.respond((_request, response) => sendJson(response, 200, JSON.parse(LIST_BODY)));
    await handleListEditorFlows(get('/api/editor/flows'));
    await handleListEditorFlows(get('/api/editor/flows?offset=40&published=true&limit=500'));
    expect(lines()).toEqual(['GET /flows?limit=20&offset=0', 'GET /flows?limit=20&offset=40']);
    expect(lines().join()).not.toContain('published');
  });

  it('leer', async () => {
    fake.api.respond((_request, response) => sendJson(response, 200, JSON.parse(FLOW_BODY)));
    await handleGetFlow(get('/x'), params);
    expect(lines()).toEqual(['GET /flows/hola']);
    expect(fake.api.requests[0]!.body).toBe('');
  });

  it('crear: POST /flows con el texto JSON, content-type y content-length', async () => {
    fake.api.respond((_request, response) => sendJson(response, 201, JSON.parse(FLOW_BODY)));
    await handleCreateFlow(send('POST', '/api/editor/flows', HOLA));
    const received = fake.api.requests[0]!;
    expect(`${received.method} ${received.path}`).toBe('POST /flows');
    expect(received.body).toBe(HOLA);
    expect(Object.keys(received.headers).sort()).toEqual(['connection', 'content-length', 'content-type', 'host']);
    expect(received.headers['content-length']).toBe(String(Buffer.byteLength(HOLA)));
    expect(received.headers['content-type']).toBe('application/json');
  });

  it('guardar: PUT /flows/:id con If-Match y el texto JSON', async () => {
    fake.api.respond((_request, response) => sendJson(response, 200, JSON.parse(FLOW_UPDATED_BODY)));
    await handleUpdateFlow(send('PUT', '/api/editor/flows/hola', HOLA, { 'If-Match': '"1"' }), params);
    const received = fake.api.requests[0]!;
    expect(`${received.method} ${received.path}`).toBe('PUT /flows/hola');
    expect(received.body).toBe(HOLA);
    expect(Object.keys(received.headers).sort()).toEqual(['connection', 'content-length', 'content-type', 'host', 'if-match']);
    expect(received.headers['if-match']).toBe('"1"');
  });

  it('publicar: POST …/versions con If-Match, Content-Length: 0 y sin Content-Type', async () => {
    fake.api.respond((_request, response) => sendJson(response, 201, JSON.parse(VERSION_BODY)));
    await handlePublishFlow(unreadable('POST', '/api/editor/flows/hola/versions', { 'If-Match': '"2"', 'Content-Type': 'application/json' }), params);
    const received = fake.api.requests[0]!;
    expect(`${received.method} ${received.path}`).toBe('POST /flows/hola/versions');
    expect(received.body).toBe('');
    expect(received.headers['if-match']).toBe('"2"');
    expect(received.headers['content-length']).toBe('0');
    expect(received.headers['content-type']).toBeUndefined();
  });

  it('borrar: DELETE /flows/:id con If-Match, sin Content-Length ni cuerpo', async () => {
    fake.api.respond((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const response = await handleDeleteFlow(unreadable('DELETE', '/api/editor/flows/hola', { 'If-Match': '"2"' }), params);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    const received = fake.api.requests[0]!;
    expect(`${received.method} ${received.path}`).toBe('DELETE /flows/hola');
    expect(received.headers['if-match']).toBe('"2"');
    expect(received.headers['content-length']).toBeUndefined();
    expect(received.headers['content-type']).toBeUndefined();
  });

  it('una cookie, Authorization, Referer o X-Extra del navegador no llegan a la API', async () => {
    fake.api.respond((_request, response) => sendJson(response, 200, JSON.parse(FLOW_UPDATED_BODY)));
    await handleUpdateFlow(send('PUT', '/api/editor/flows/hola', HOLA, { 'If-Match': '"1"', Cookie: 'sesion=1', 'X-Extra': '1', Authorization: 'Bearer x', Referer: `${BASE}/flujos/hola`, 'User-Agent': 'navegador' }), params);
    const received = fake.api.requests[0]!;
    expect(received.headers.host).toBe(new URL(fake.api.url).host);
    for (const name of ['origin', 'cookie', 'authorization', 'referer', 'x-extra', 'user-agent']) expect(received.headers[name]).toBeUndefined();
  });
});

describe('If-Match de las tres mutaciones con él', () => {
  const calls = [
    (headers: Record<string, string>) => handleUpdateFlow(send('PUT', '/api/editor/flows/hola', HOLA, headers), params),
    (headers: Record<string, string>) => handlePublishFlow(send('POST', '/api/editor/flows/hola/versions', undefined, headers), params),
    (headers: Record<string, string>) => handleDeleteFlow(send('DELETE', '/api/editor/flows/hola', undefined, headers), params),
  ];

  it('ausente es 428 precondition_required y no llama (también en publicar y borrar, donde la API lo admite)', async () => {
    for (const call of calls) {
      const response = await call({});
      expect(response.status).toBe(428);
      expect(await response.json()).toEqual({ error: 'precondition_required' });
    }
    expect(fake.api.requests).toEqual([]);
  });

  it('*, W/"1" y 1 son 400 invalid_request y no llaman (optionalIfMatchOnEditor)', async () => {
    for (const bad of ['*', 'W/"1"', '1', '"x"', '"12345678901"']) {
      for (const call of calls) {
        const response = await call({ 'If-Match': bad });
        expect(response.status, bad).toBe(400);
        expect(await response.json()).toEqual({ error: 'invalid_request' });
      }
    }
    expect(fake.api.requests).toEqual([]);
  });
});

describe('ids de flujo', () => {
  it('un id inválido es 404 flow_not_found en las cinco rutas con id y no llega a la API (unvalidatedFlowId)', async () => {
    for (const flowId of ['..%2Fconversations', '../flows', 'Hola', 'a b', '', '1abc', 'a'.repeat(65), 'a/b']) {
      const bad = { flowId };
      const responses = [
        await handleGetFlow(get('/x'), bad),
        await handleUpdateFlow(send('PUT', '/api/editor/flows/x', HOLA, { 'If-Match': '"1"' }), bad),
        await handlePublishFlow(send('POST', '/api/editor/flows/x/versions', undefined, { 'If-Match': '"1"' }), bad),
        await handleDeleteFlow(send('DELETE', '/api/editor/flows/x', undefined, { 'If-Match': '"1"' }), bad),
      ];
      for (const response of responses) {
        expect(response.status, flowId).toBe(404);
        expect(await response.json()).toEqual({ error: 'flow_not_found' });
      }
    }
    expect(fake.api.requests).toEqual([]);
  });

  it('un offset inválido es 400 invalid_query', async () => {
    for (const bad of ['-1', '1.5', 'x', '2147483648', '']) {
      const response = await handleListEditorFlows(get(`/api/editor/flows?offset=${bad}`));
      expect(response.status, bad).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_query' });
    }
    expect(fake.api.requests).toEqual([]);
  });
});

describe('la frontera repetida en las cuatro mutaciones (skipEditorFrontierRecheck)', () => {
  it('Host ajeno, sin Origin, Origin null o de otro Host dan 403 sin cuerpo y sin llamar a la API', async () => {
    const bad: Record<string, string>[] = [{ Host: 'evil.example:3000', Origin: 'http://evil.example:3000' }, { Host: 'localhost:3000' }, { Host: 'localhost:3000', Origin: 'null' }, { Host: 'localhost:3000', Origin: 'http://127.0.0.1:3000' }, { Host: 'localhost:3000', Origin: 'https://evil.example' }];
    for (const headers of bad) {
      const base = { 'Content-Type': 'application/json', 'If-Match': '"1"', ...headers };
      const responses = [
        await handleCreateFlow(new Request(`${BASE}/api/editor/flows`, { method: 'POST', body: HOLA, headers: base })),
        await handleUpdateFlow(new Request(`${BASE}/api/editor/flows/hola`, { method: 'PUT', body: HOLA, headers: base }), params),
        await handlePublishFlow(new Request(`${BASE}/api/editor/flows/hola/versions`, { method: 'POST', headers: base }), params),
        await handleDeleteFlow(new Request(`${BASE}/api/editor/flows/hola`, { method: 'DELETE', headers: base }), params),
      ];
      for (const response of responses) {
        expect(response.status, JSON.stringify(headers)).toBe(403);
        expect(await response.text()).toBe('');
      }
    }
    expect(fake.api.requests).toEqual([]);
  });

  it('una ruta del editor con un id inválido que llega al manejador responde flow_not_found (el cuerpo de la decisión)', async () => {
    const response = await handleUpdateFlow(new Request(`${BASE}/api/editor/flows/Hola`, { method: 'PUT', body: HOLA, headers: { ...ORIGIN_HEADERS, 'If-Match': '"1"' } }), { flowId: 'Hola' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'flow_not_found' });
  });
});

describe('cuerpo de un flujo', () => {
  it.each([
    ['una lista', '[]'],
    ['null', 'null'],
    ['un texto', '"x"'],
    ['un número', '5'],
  ])('%s es 400 invalid_request y no llama a la API (acceptNonObjectFlowBody)', async (_name, body) => {
    for (const call of [
      () => handleCreateFlow(send('POST', '/api/editor/flows', body)),
      () => handleUpdateFlow(send('PUT', '/api/editor/flows/hola', body, { 'If-Match': '"1"' }), params),
    ]) {
      const response = await call();
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(fake.api.requests).toEqual([]);
  });

  it('un cuerpo que no es JSON o está vacío es 400 invalid_json', async () => {
    for (const body of ['{"id":', '', 'no json']) {
      const response = await handleCreateFlow(send('POST', '/api/editor/flows', body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_json' });
    }
    expect(fake.api.requests).toEqual([]);
  });

  // 1 048 577 bytes es 413 y `[]` es 400, sin llamar a la API.
  it('Cuerpo de un flujo demasiado grande', async () => {
    const big = `{"x":"${'a'.repeat(1_048_577 - 8)}"}`;
    expect(Buffer.byteLength(big)).toBe(1_048_577);
    const tooBig = await handleCreateFlow(send('POST', '/api/editor/flows', big));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: 'payload_too_large' });
    const list = await handleCreateFlow(send('POST', '/api/editor/flows', '[]'));
    expect(list.status).toBe(400);
    expect(await list.json()).toEqual({ error: 'invalid_request' });
    const saving = await handleUpdateFlow(send('PUT', '/api/editor/flows/hola', big, { 'If-Match': '"1"' }), params);
    expect(saving.status).toBe(413);
    expect(fake.api.requests).toEqual([]);
  });

  it('el tope por Content-Length declarado también da 413 sin leer', async () => {
    const response = await handleCreateFlow(send('POST', '/api/editor/flows', HOLA, { 'Content-Length': String(2 * 1024 * 1024) }));
    expect(response.status).toBe(413);
    expect(fake.api.requests).toEqual([]);
  });

  it('un cuerpo poco profundo con espacios no canónicos llega serializado de nuevo', async () => {
    fake.api.respond((_request, response) => sendJson(response, 201, JSON.parse(FLOW_BODY)));
    await handleCreateFlow(send('POST', '/api/editor/flows', `{ "specVersion" : "0.1",\n "id": "hola" , "name":"Hola",  "start":"fin", "nodes":[ {"id":"fin","type":"end"} ] }`));
    expect(fake.api.requests[0]!.body).toBe(HOLA);
  });

  it('un cuerpo de 100 000 niveles con espacios no canónicos llega a la API exactamente como se recibió y no da 500 (stringifyWithoutDepthGuard)', async () => {
    const deep = `{ "a" : ${'[ '.repeat(100_000)}${' ]'.repeat(100_000)} }`;
    expect(Buffer.byteLength(deep)).toBeLessThan(1_048_576);
    fake.api.respond((_request, response) => sendJson(response, 400, JSON.parse(INVALID_FLOW_BODY)));
    const response = await handleUpdateFlow(send('PUT', '/api/editor/flows/hola', deep, { 'If-Match': '"1"' }), params);
    expect(fake.api.requests).toHaveLength(1);
    expect(fake.api.requests[0]!.body).toBe(deep);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_flow' });
  });

  it('un cuerpo con __proto__ llega con __proto__ como clave propia', async () => {
    fake.api.respond((_request, response) => sendJson(response, 400, JSON.parse(INVALID_FLOW_BODY)));
    await handleCreateFlow(send('POST', '/api/editor/flows', '{"__proto__":{"x":1},"id":"a"}'));
    expect(fake.api.requests[0]!.body).toBe('{"__proto__":{"x":1},"id":"a"}');
  });
});

describe('respuestas', () => {
  it('los 2xx pasan con su estado y su JSON (también warnings y el flujo)', async () => {
    fake.api.respond((request, response) => sendJson(response, request.method === 'POST' && request.path === '/flows' ? 201 : 200, JSON.parse(request.path === '/flows?limit=20&offset=0' ? LIST_BODY : FLOW_BODY)));
    const created = await handleCreateFlow(send('POST', '/api/editor/flows', HOLA));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(JSON.parse(FLOW_BODY));
    const listed = await handleListEditorFlows(get('/api/editor/flows'));
    expect(await listed.json()).toEqual(JSON.parse(LIST_BODY));
    expect(created.headers.get('cache-control')).toContain('no-store');
  });

  it('el 204 de borrar es 204; fuera de borrar un 204 es invalid_api_response', async () => {
    fake.api.respond((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    expect((await handleDeleteFlow(send('DELETE', '/api/editor/flows/hola', undefined, { 'If-Match': '"1"' }), params)).status).toBe(204);
    const publish = await handlePublishFlow(send('POST', '/api/editor/flows/hola/versions', undefined, { 'If-Match': '"1"' }), params);
    expect(publish.status).toBe(502);
  });

  it('el error sale sin message, issues ni warnings (forwardIssues)', async () => {
    fake.api.respond((_request, response) =>
      sendJson(response, 400, { message: 'MARCA-MENSAJE', error: 'invalid_flow', issues: [{ layer: 'semantic', path: '/start', message: 'MARCA-ISSUE' }], warnings: [{ code: 'x', path: '', message: 'MARCA-AVISO' }] }),
    );
    for (const call of [
      () => handleUpdateFlow(send('PUT', '/api/editor/flows/hola', HOLA, { 'If-Match': '"1"' }), params),
      () => handleCreateFlow(send('POST', '/api/editor/flows', HOLA)),
    ]) {
      const response = await call();
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe('{"error":"invalid_flow"}');
      for (const mark of ['MARCA-MENSAJE', 'MARCA-ISSUE', 'MARCA-AVISO', 'issues', 'warnings']) expect(text).not.toContain(mark);
    }
  });

  it('currentRevision llega en el 412 de guardar, publicar y borrar', async () => {
    fake.api.respond((_request, response) => sendJson(response, 412, JSON.parse(REVISION_MISMATCH_BODY)));
    for (const response of [
      await handleUpdateFlow(send('PUT', '/api/editor/flows/hola', HOLA, { 'If-Match': '"1"' }), params),
      await handlePublishFlow(send('POST', '/api/editor/flows/hola/versions', undefined, { 'If-Match': '"1"' }), params),
      await handleDeleteFlow(send('DELETE', '/api/editor/flows/hola', undefined, { 'If-Match': '"1"' }), params),
    ]) {
      expect(response.status).toBe(412);
      expect(await response.json()).toEqual({ error: 'revision_mismatch', currentRevision: 2 });
    }
  });

  it('502 api_unreachable si la API está parada', async () => {
    await fake.api.stop();
    try {
      const response = await handleGetFlow(get('/x'), params);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'api_unreachable' });
    } finally {
      await fake.api.start();
    }
  });

  it('un 5xx registra solo la plantilla, el estado y el código: nunca el id, el flujo ni sus marcas', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.api.respond((_request, response) => sendJson(response, 503, { message: 'MARCA-MENSAJE', error: 'database_unavailable' }));
    await handleUpdateFlow(send('PUT', '/api/editor/flows/hola', '{"id":"hola","name":"MARCA-FLUJO"}', { 'If-Match': '"1"' }), params);
    await handleGetFlow(get('/x'), params);
    await handleListEditorFlows(get('/api/editor/flows'));
    await handleCreateFlow(send('POST', '/api/editor/flows', '{"id":"MARCA-FLUJO"}'));
    await handlePublishFlow(send('POST', '/api/editor/flows/hola/versions', undefined, { 'If-Match': '"1"' }), params);
    await handleDeleteFlow(send('DELETE', '/api/editor/flows/hola', undefined, { 'If-Match': '"1"' }), params);
    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([
      '[web] PUT /api/editor/flows/[flowId] 503 database_unavailable',
      '[web] GET /api/editor/flows/[flowId] 503 database_unavailable',
      '[web] GET /api/editor/flows 503 database_unavailable',
      '[web] POST /api/editor/flows 503 database_unavailable',
      '[web] POST /api/editor/flows/[flowId]/versions 503 database_unavailable',
      '[web] DELETE /api/editor/flows/[flowId] 503 database_unavailable',
    ]);
  });
});

describe('con las respuestas copiadas de la API real (real-flow-shapes)', () => {
  async function withRaw<T>(buffer: Buffer, run: () => Promise<T>): Promise<{ result: T; requests: string[] }> {
    const raw = await startRawApi(() => buffer);
    const previous = process.env.FRANCA_API_URL;
    process.env.FRANCA_API_URL = `http://127.0.0.1:${raw.port}`;
    try {
      return { result: await run(), requests: raw.requests };
    } finally {
      process.env.FRANCA_API_URL = previous;
      await raw.close();
    }
  }
  const json = async (response: Response) => ({ status: response.status, body: (await response.text()) === '' ? '' : undefined });

  it('201 de crear, 200 de leer y de listar, 200 de guardar y 201 y 200 de publicar', async () => {
    const created = await withRaw(RAW_FLOW_201, () => handleCreateFlow(send('POST', '/api/editor/flows', HOLA)));
    expect(created.result.status).toBe(201);
    expect(await created.result.json()).toEqual(JSON.parse(FLOW_BODY));
    expect(created.requests[0]).toMatch(/^POST \/flows HTTP\/1.1\r\nHost: 127.0.0.1:\d+\r\nConnection: close\r\nContent-Type: application\/json\r\nContent-Length: \d+\r\n\r\n/);
    const read = await withRaw(RAW_FLOW_200, () => handleGetFlow(get('/x'), params));
    expect(await read.result.json()).toEqual(JSON.parse(FLOW_BODY));
    const list = await withRaw(RAW_LIST_200, () => handleListEditorFlows(get('/api/editor/flows')));
    expect(await list.result.json()).toEqual(JSON.parse(LIST_BODY));
    const saved = await withRaw(RAW_PUT_200, () => handleUpdateFlow(send('PUT', '/api/editor/flows/hola', HOLA, { 'If-Match': '"1"' }), params));
    expect(saved.result.status).toBe(200);
    expect(await saved.result.json()).toEqual(JSON.parse(FLOW_UPDATED_BODY));
    expect(saved.requests[0]).toContain('If-Match: "1"\r\n');
    const first = await withRaw(RAW_VERSION_201, () => handlePublishFlow(send('POST', '/api/editor/flows/hola/versions', undefined, { 'If-Match': '"2"' }), params));
    expect(first.result.status).toBe(201);
    expect(await first.result.json()).toEqual(JSON.parse(VERSION_BODY));
    expect(first.requests[0]).toMatch(/^POST \/flows\/hola\/versions HTTP\/1.1\r\nHost: 127.0.0.1:\d+\r\nConnection: close\r\nIf-Match: "2"\r\nContent-Length: 0\r\n\r\n$/);
    const again = await withRaw(RAW_VERSION_200, () => handlePublishFlow(send('POST', '/api/editor/flows/hola/versions', undefined, { 'If-Match': '"2"' }), params));
    expect(again.result.status).toBe(200);
  });

  it('el 204 real de borrar no lleva Content-Length ni cuerpo', async () => {
    const deleted = await withRaw(RAW_DELETE_204, () => handleDeleteFlow(send('DELETE', '/api/editor/flows/hola', undefined, { 'If-Match': '"2"' }), params));
    expect(deleted.result.status).toBe(204);
    expect(await deleted.result.text()).toBe('');
    expect(deleted.requests[0]).toMatch(/^DELETE \/flows\/hola HTTP\/1.1\r\nHost: 127.0.0.1:\d+\r\nConnection: close\r\nIf-Match: "2"\r\n\r\n$/);
  });

  it('los errores reales: 412, 404, 409 (existe y reservado), 400 invalid_flow y literal_credential, sin message', async () => {
    const mismatch = await withRaw(RAW_412, () => handleUpdateFlow(send('PUT', '/api/editor/flows/hola', HOLA, { 'If-Match': '"1"' }), params));
    expect(mismatch.result.status).toBe(412);
    expect(await mismatch.result.json()).toEqual({ error: 'revision_mismatch', currentRevision: 2 });
    const missing = await withRaw(RAW_404, () => handleGetFlow(get('/x'), params));
    expect(await missing.result.text()).toBe('{"error":"flow_not_found"}');
    const exists = await withRaw(RAW_409_EXISTS, () => handleCreateFlow(send('POST', '/api/editor/flows', HOLA)));
    expect(exists.result.status).toBe(409);
    expect(await exists.result.json()).toEqual({ error: 'flow_already_exists' });
    const reserved = await withRaw(RAW_409_RESERVED, () => handleCreateFlow(send('POST', '/api/editor/flows', HOLA)));
    expect(await reserved.result.json()).toEqual({ error: 'flow_id_reserved' });
    const invalid = await withRaw(RAW_400_INVALID_FLOW, () => handleCreateFlow(send('POST', '/api/editor/flows', HOLA)));
    expect(await invalid.result.text()).toBe('{"error":"invalid_flow"}');
    const literal = await withRaw(RAW_400_LITERAL, () => handleCreateFlow(send('POST', '/api/editor/flows', HOLA)));
    expect(await literal.result.text()).toBe('{"error":"literal_credential"}');
    void json;
  });
});
