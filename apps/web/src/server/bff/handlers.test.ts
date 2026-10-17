import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleCreateConversation,
  handleDeleteConversation,
  handleFlowVersion,
  handleGetConversation,
  handleListConversations,
  handleListFlows,
  handleNotFound,
  handleSendInput,
  handleTranscript,
} from '@/server/bff/handlers';
import { sendJson } from '../../../tests/helpers/fake-api';
import { withFakeApi } from '../../../tests/helpers/api-env';
import {
  ADVANCE_BODY,
  BUSY_BODY,
  CREATED_BODY,
  NOT_FOUND_BODY,
  RAW_200,
  RAW_201,
  RAW_204,
  RAW_404,
  RAW_409,
  RAW_412,
  REVISION_MISMATCH_BODY,
  startRawApi,
} from '../../../tests/helpers/real-api-shapes';

const ID = '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90';
const BASE = 'http://localhost:3000';
const fake = withFakeApi();

const ORIGIN_HEADERS = { Host: 'localhost:3000', Origin: BASE };
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS, ...headers } });
const get = (path: string) => new Request(`${BASE}${path}`);

afterEach(() => vi.restoreAllMocks());

/** Una petición cuyo cuerpo no se puede leer: si el manejador lo lee, el test falla. */
function unreadable(method: string, path: string): Request {
  const request = new Request(`${BASE}${path}`, { method });
  const boom = () => {
    throw new Error('el cuerpo se ha leído');
  };
  Object.defineProperty(request, 'body', { get: boom });
  for (const name of ['text', 'json', 'arrayBuffer', 'blob', 'formData'] as const) Object.defineProperty(request, name, { value: boom });
  return request;
}

describe('las ocho operaciones: ruta, consulta y método exactos', () => {
  const answer = () =>
    fake.api.respond((request, response) => {
      if (request.method === 'DELETE') {
        response.writeHead(204);
        response.end();
      } else if (request.path.startsWith('/flows/') && request.path.includes('/versions/')) {
        sendJson(response, 200, { flowId: 'captacion-leads', version: 2, name: 'Captación de leads', publishedAt: 'x', flow: { grande: true }, warnings: [] });
      } else sendJson(response, 200, { items: [], total: 0, limit: 20, offset: 0 });
    });

  it('GET /api/flows → GET /flows?published=true&limit=20&offset=N (y 0 por defecto)', async () => {
    answer();
    await handleListFlows(get('/api/flows'));
    await handleListFlows(get('/api/flows?offset=40&published=false&limit=5&x=1'));
    expect(fake.api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /flows?published=true&limit=20&offset=0',
      'GET /flows?published=true&limit=20&offset=40',
    ]);
  });

  it('GET /api/flows/:flowId/versions/:version → GET /flows/:flowId/versions/:version', async () => {
    answer();
    await handleFlowVersion(get('/x'), { flowId: 'captacion-leads', version: '2' });
    expect(fake.api.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /flows/captacion-leads/versions/2']);
  });

  it('GET /api/conversations → GET /conversations?limit=20&offset=N', async () => {
    answer();
    await handleListConversations(get('/api/conversations?offset=20&limit=500'));
    expect(fake.api.requests.map((request) => request.path)).toEqual(['/conversations?limit=20&offset=20']);
  });

  it('GET, transcript, POST inputs y DELETE de una conversación', async () => {
    answer();
    await handleGetConversation(get('/x'), { conversationId: ID });
    await handleTranscript(get('/x?offset=100'), { conversationId: ID });
    await handleDeleteConversation(new Request(`${BASE}/x`, { method: 'DELETE' }), { conversationId: ID });
    expect(fake.api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET /conversations/${ID}`,
      `GET /conversations/${ID}/transcript?limit=100&offset=100`,
      `DELETE /conversations/${ID}`,
    ]);
  });

  it('POST /api/conversations y POST …/inputs llegan a sus rutas de la API', async () => {
    fake.api.respond((_request, response) => sendJson(response, 200, JSON.parse(ADVANCE_BODY)));
    await handleCreateConversation(post('/api/conversations', '{"flowId":"pregunta"}'));
    await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"Ana"}}', { 'If-Match': '"1"' }), { conversationId: ID });
    expect(fake.api.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['POST /conversations', `POST /conversations/${ID}/inputs`]);
  });

  it('cualquier otra ruta o método de /api responde 404 not_found sin llamar a la API', async () => {
    const response = handleNotFound();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(fake.api.requests).toEqual([]);
  });
});

describe('peticiones del navegador', () => {
  it('un GET y un DELETE no leen el cuerpo ni lo reenvían', async () => {
    fake.api.respond((request, response) => {
      if (request.method === 'DELETE') {
        response.writeHead(204);
        response.end();
      } else sendJson(response, 200, { items: [], total: 0, limit: 20, offset: 0 });
    });
    expect((await handleListFlows(unreadable('GET', '/api/flows'))).status).toBe(200);
    expect((await handleDeleteConversation(unreadable('DELETE', `/api/conversations/${ID}`), { conversationId: ID })).status).toBe(204);
    expect(fake.api.requests.map((request) => request.body)).toEqual(['', '']);
  });

  it('reconstruye los cuerpos: {"flowId"}, {"flowId","contactId"} y {"input":…} con los espacios', async () => {
    fake.api.respond((_request, response) => sendJson(response, 201, JSON.parse(CREATED_BODY)));
    await handleCreateConversation(post('/api/conversations', '{"flowId":"pregunta","extra":1,"__proto__":{"x":1}}'));
    await handleCreateConversation(post('/api/conversations', '{ "contactId": "c-1", "flowId": "pregunta", "otra": true }'));
    await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"x":1,"input":{"text":" Ana "}}', { 'If-Match': '"2"' }), { conversationId: ID });
    expect(fake.api.requests.map((request) => request.body)).toEqual([
      '{"flowId":"pregunta"}',
      '{"flowId":"pregunta","contactId":"c-1"}',
      '{"input":{"text":" Ana "}}',
    ]);
    expect(fake.api.requests[2]!.headers['if-match']).toBe('"2"');
  });

  it("contactId '' llega tal cual a la API: el servidor de la web no convierte", async () => {
    fake.api.respond((_request, response) => sendJson(response, 400, { message: 'x', error: 'invalid_request' }));
    const response = await handleCreateConversation(post('/api/conversations', '{"flowId":"pregunta","contactId":""}'));
    expect(fake.api.requests[0]!.body).toBe('{"flowId":"pregunta","contactId":""}');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('input acepta cualquier valor, también null o un objeto desconocido, pero tiene que existir', async () => {
    fake.api.respond((_request, response) => sendJson(response, 400, { message: 'x', error: 'invalid_input' }));
    await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":null}', { 'If-Match': '"1"' }), { conversationId: ID });
    expect(fake.api.requests[0]!.body).toBe('{"input":null}');
    const missing = await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"entrada":1}', { 'If-Match': '"1"' }), { conversationId: ID });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'invalid_request' });
    expect(fake.api.requests).toHaveLength(1);
  });

  it.each([
    ['no es JSON', 'no json', 400, 'invalid_json'],
    ['vacío', '', 400, 'invalid_json'],
    ['una lista', '[]', 400, 'invalid_request'],
    ['sin flowId', '{}', 400, 'invalid_request'],
    ['flowId que no es texto', '{"flowId":3}', 400, 'invalid_request'],
    ['contactId que no es texto', '{"flowId":"a","contactId":3}', 400, 'invalid_request'],
    ['contactId null', '{"flowId":"a","contactId":null}', 400, 'invalid_request'],
  ])('crear con un cuerpo %s es %i %s y no llama a la API', async (_name, body, status, error) => {
    const response = await handleCreateConversation(post('/api/conversations', body));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(fake.api.requests).toEqual([]);
  });

  it('un cuerpo con UTF-8 inválido es 400 invalid_json', async () => {
    const request = new Request(`${BASE}/api/conversations`, { method: 'POST', body: new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]), headers: { 'Content-Type': 'application/json' } });
    const response = await handleCreateConversation(request);
    expect(response.status).toBe(400);
    expect(fake.api.requests).toEqual([]);
  });

  it('el tope de 1 MiB: por encima, 413 payload_too_large sin llamar; un cuerpo de 70 000 caracteres sí llega a la API', async () => {
    fake.api.respond((_request, response) => sendJson(response, 413, { message: 'x', error: 'payload_too_large' }));
    const big = JSON.stringify({ input: { text: 'a'.repeat(1024 * 1024) } });
    const over = await handleSendInput(post(`/api/conversations/${ID}/inputs`, big, { 'If-Match': '"1"' }), { conversationId: ID });
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: 'payload_too_large' });
    expect(fake.api.requests).toEqual([]);

    const seventyThousand = JSON.stringify({ input: { text: 'a'.repeat(70_000) } });
    const response = await handleSendInput(post(`/api/conversations/${ID}/inputs`, seventyThousand, { 'If-Match': '"1"' }), { conversationId: ID });
    expect(fake.api.requests).toHaveLength(1);
    expect(fake.api.requests[0]!.body).toBe(seventyThousand);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
  });

  it('el tope por Content-Length declarado también da 413 sin leer', async () => {
    const request = post(`/api/conversations/${ID}/inputs`, '{"input":{}}', { 'If-Match': '"1"', 'Content-Length': String(2 * 1024 * 1024) });
    const response = await handleSendInput(request, { conversationId: ID });
    expect(response.status).toBe(413);
    expect(fake.api.requests).toEqual([]);
  });

  it('If-Match ausente es 428 y mal formado es 400, sin llamar a la API', async () => {
    const missing = await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"a"}}'), { conversationId: ID });
    expect(missing.status).toBe(428);
    expect(await missing.json()).toEqual({ error: 'precondition_required' });
    for (const bad of ['1', 'W/"1"', '"01x"', '*', '"12345678901"', '"1", "2"', '""', '"-1"']) {
      const response = await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"a"}}', { 'If-Match': bad }), { conversationId: ID });
      expect(response.status, bad).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(fake.api.requests).toEqual([]);
  });

  it('un offset inválido es 400 invalid_query sin llamar a la API', async () => {
    for (const bad of ['-1', '1.5', 'x', '2147483648', '12345678901', '']) {
      const response = await handleListConversations(get(`/api/conversations?offset=${bad}`));
      expect(response.status, bad).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_query' });
    }
    expect((await handleTranscript(get(`/x?offset=zz`), { conversationId: ID })).status).toBe(400);
    expect(fake.api.requests).toEqual([]);
  });

  it('los cuatro casos de «Id de conversación con una ruta dentro» son conversation_not_found y no llaman a la API', async () => {
    const bad = ['..%2F..%2Fflows%2Fhola', '00000000-0000-4000-8000-00000000000A'];
    for (const conversationId of bad) {
      const send = await handleSendInput(post(`/api/conversations/${conversationId}/inputs`, '{"input":{"text":"a"}}', { 'If-Match': '"1"' }), { conversationId });
      const remove = await handleDeleteConversation(new Request(`${BASE}/x`, { method: 'DELETE' }), { conversationId });
      for (const response of [send, remove]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: 'conversation_not_found' });
      }
      expect((await handleGetConversation(get('/x'), { conversationId })).status).toBe(404);
      expect((await handleTranscript(get('/x'), { conversationId })).status).toBe(404);
    }
    expect(fake.api.requests).toEqual([]);
  });

  it('un flowId o una versión inválidos no llegan a la API', async () => {
    for (const params of [{ flowId: '../flows', version: '1' }, { flowId: 'Hola', version: '1' }, { flowId: 'hola', version: '0' }, { flowId: 'hola', version: '1/../..' }]) {
      const response = await handleFlowVersion(get('/x'), params);
      expect(response.status).toBe(404);
    }
    expect(fake.api.requests).toEqual([]);
  });

  it('una cookie o una cabecera X-Extra del navegador no llegan a la API', async () => {
    fake.api.respond((_request, response) => sendJson(response, 200, JSON.parse(ADVANCE_BODY)));
    const request = post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"a"}}', {
      'If-Match': '"1"',
      Cookie: 'sesion=1',
      'X-Extra': '1',
      Authorization: 'Bearer x',
      Referer: 'http://localhost:3000/',
      'User-Agent': 'navegador',
    });
    await handleSendInput(request, { conversationId: ID });
    const received = fake.api.requests[0]!;
    expect(Object.keys(received.headers).sort()).toEqual(['connection', 'content-length', 'content-type', 'host', 'if-match']);
    expect(received.headers.host).toBe(new URL(fake.api.url).host);
    for (const name of ['origin', 'cookie', 'authorization', 'referer', 'x-extra', 'user-agent']) expect(received.headers[name]).toBeUndefined();
  });
});

describe('respuestas de la API', () => {
  it('conserva el estado y el JSON de un 201 y de un 200', async () => {
    fake.api.respond((request, response) => sendJson(response, request.path === '/conversations' ? 201 : 200, JSON.parse(request.path === '/conversations' ? CREATED_BODY : ADVANCE_BODY)));
    const created = await handleCreateConversation(post('/api/conversations', '{"flowId":"pregunta"}'));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(JSON.parse(CREATED_BODY));
    const advanced = await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"a"}}', { 'If-Match': '"1"' }), { conversationId: ID });
    expect(advanced.status).toBe(200);
    expect(await advanced.json()).toEqual(JSON.parse(ADVANCE_BODY));
    expect(advanced.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(advanced.headers.get('cache-control')).toContain('no-store');
  });

  it('quita el message de los error del avance y de la transcripción, y no toca el resto', async () => {
    const error = { type: 'error', nodeId: 'enviar-crm', code: 'missing_secret', message: 'MARCA-MENSAJE: el host no tiene un secreto' };
    fake.api.respond((request, response) => {
      if (request.path.includes('/transcript')) {
        sendJson(response, 200, { items: [{ seq: 1, at: 'x', role: 'flow', event: error }, { seq: 2, at: 'x', role: 'flow', event: { type: 'message', nodeId: 'a', content: [], typingDelayMs: 0, message: 'se queda' } }], total: 2, limit: 100, offset: 0 });
      } else sendJson(response, 200, { conversation: JSON.parse(ADVANCE_BODY).conversation, events: [error, { type: 'end', nodeId: 'fin', outcome: null }] });
    });
    const advance = await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"a"}}', { 'If-Match': '"1"' }), { conversationId: ID });
    const transcript = await handleTranscript(get('/x'), { conversationId: ID });
    const advanceText = await advance.text();
    const transcriptText = await transcript.text();
    expect(advanceText).not.toContain('MARCA-MENSAJE');
    expect(transcriptText).not.toContain('MARCA-MENSAJE');
    expect(JSON.parse(advanceText).events[0]).toEqual({ type: 'error', nodeId: 'enviar-crm', code: 'missing_secret' });
    expect(JSON.parse(transcriptText).items[0].event).toEqual({ type: 'error', nodeId: 'enviar-crm', code: 'missing_secret' });
    expect(JSON.parse(transcriptText).items[1].event.message).toBe('se queda');
  });

  it('el message de la API nunca sale en un cuerpo de error', async () => {
    fake.api.respond((_request, response) => sendJson(response, 409, { message: 'MARCA-MENSAJE', error: 'codigo_nuevo', extra: 'x' }));
    const response = await handleGetConversation(get('/x'), { conversationId: ID });
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).not.toContain('MARCA-MENSAJE');
    expect(JSON.parse(text)).toEqual({ error: 'codigo_nuevo' });
  });

  it('un código desconocido pasa y currentRevision llega en el 412', async () => {
    fake.api.respond((_request, response) => sendJson(response, 412, { message: 'x', error: 'revision_mismatch', currentRevision: 2, otro: 1 }));
    const response = await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"a"}}', { 'If-Match': '"1"' }), { conversationId: ID });
    expect(response.status).toBe(412);
    expect(await response.json()).toEqual({ error: 'revision_mismatch', currentRevision: 2 });
    fake.api.respond((_request, response) => sendJson(response, 409, { message: 'x', error: 'revision_mismatch', currentRevision: 'dos' }));
    expect(await (await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"a"}}', { 'If-Match': '"1"' }), { conversationId: ID })).json()).toEqual({ error: 'revision_mismatch' });
  });

  it('un código que no cumple el formato no pasa: mismo estado sin cuerpo', async () => {
    for (const error of ['Mayúsculas', '1abc', 'a-b', '', 'a'.repeat(65)]) {
      fake.api.respond((_request, response) => sendJson(response, 409, { message: 'x', error }));
      const response = await handleGetConversation(get('/x'), { conversationId: ID });
      expect(response.status).toBe(409);
      expect(await response.text()).toBe('');
    }
  });

  it('un 4xx/5xx de la API sin cuerpo llega con el mismo estado y sin cuerpo', async () => {
    for (const status of [403, 405, 500, 503]) {
      fake.api.respond((_request, response) => {
        response.writeHead(status);
        response.end();
      });
      const response = await handleGetConversation(get('/x'), { conversationId: ID });
      expect(response.status).toBe(status);
      expect(await response.text()).toBe('');
    }
  });

  it('un 2xx sin JSON, vacío, o un 204 fuera de DELETE es 502 invalid_api_response', async () => {
    for (const reply of [
      (response: import('node:http').ServerResponse) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<html>');
      },
      (response: import('node:http').ServerResponse) => {
        response.writeHead(200);
        response.end();
      },
      (response: import('node:http').ServerResponse) => {
        response.writeHead(204);
        response.end();
      },
      (response: import('node:http').ServerResponse) => {
        response.writeHead(200);
        response.end('[1,2]');
      },
    ]) {
      fake.api.respond((_request, response) => reply(response));
      const response = await handleGetConversation(get('/x'), { conversationId: ID });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'invalid_api_response' });
    }
  });

  it('la versión se reduce a {flowId, version, name}', async () => {
    fake.api.respond((_request, response) => sendJson(response, 200, { flowId: 'captacion-leads', version: 1, name: 'Captación de leads', publishedAt: 'x', flow: { nodes: [] }, warnings: [] }));
    const response = await handleFlowVersion(get('/x'), { flowId: 'captacion-leads', version: '1' });
    expect(await response.json()).toEqual({ flowId: 'captacion-leads', version: 1, name: 'Captación de leads' });
    fake.api.respond((_request, response) => sendJson(response, 200, { flowId: 'x' }));
    expect((await handleFlowVersion(get('/x'), { flowId: 'captacion-leads', version: '1' })).status).toBe(502);
  });

  it('502 api_unreachable si la API está parada', async () => {
    await fake.api.stop();
    try {
      const response = await handleGetConversation(get('/x'), { conversationId: ID });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'api_unreachable' });
    } finally {
      await fake.api.start();
    }
  });

  it('502 invalid_api_response con un status fuera de rango', async () => {
    const raw = await startRawApi(() => Buffer.from('HTTP/1.1 600 Raro\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}'));
    const previous = process.env.FRANCA_API_URL;
    process.env.FRANCA_API_URL = `http://127.0.0.1:${raw.port}`;
    try {
      const response = await handleGetConversation(get('/x'), { conversationId: ID });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'invalid_api_response' });
    } finally {
      process.env.FRANCA_API_URL = previous;
      await raw.close();
    }
  });
});

describe('con las respuestas copiadas de la API real', () => {
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

  it('DELETE con el 204 real: 204 sin cuerpo', async () => {
    const { result, requests } = await withRaw(RAW_204, () => handleDeleteConversation(new Request(`${BASE}/x`, { method: 'DELETE' }), { conversationId: ID }));
    expect(result.status).toBe(204);
    expect(await result.text()).toBe('');
    expect(requests[0]).toMatch(new RegExp(`^DELETE /conversations/${ID} HTTP/1.1\\r\\nHost: 127.0.0.1:\\d+\\r\\nConnection: close\\r\\n\\r\\n$`));
  });

  it('el 201 real, el 200 real y el 412 real', async () => {
    const created = await withRaw(RAW_201, () => handleCreateConversation(post('/api/conversations', '{"flowId":"pregunta"}')));
    expect(created.result.status).toBe(201);
    expect(await created.result.json()).toEqual(JSON.parse(CREATED_BODY));
    expect(created.requests[0]).toContain('Content-Type: application/json\r\nContent-Length: 21\r\n');

    const advanced = await withRaw(RAW_200, () => handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"Ana"}}', { 'If-Match': '"1"' }), { conversationId: ID }));
    expect(advanced.result.status).toBe(200);
    expect(await advanced.result.json()).toEqual(JSON.parse(ADVANCE_BODY));
    expect(advanced.requests[0]).toContain('If-Match: "1"\r\n');

    const mismatch = await withRaw(RAW_412, () => handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"Ana"}}', { 'If-Match': '"1"' }), { conversationId: ID }));
    expect(mismatch.result.status).toBe(412);
    expect(await mismatch.result.json()).toEqual({ error: 'revision_mismatch', currentRevision: 1 });
    expect(REVISION_MISMATCH_BODY).toContain('"message"');
  });

  it('el 409 real conversation_busy y el 404 real, sin su message', async () => {
    const busy = await withRaw(RAW_409, () => handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"Ana"}}', { 'If-Match': '"1"' }), { conversationId: ID }));
    expect(busy.result.status).toBe(409);
    expect(await busy.result.json()).toEqual({ error: 'conversation_busy' });
    expect(BUSY_BODY).toContain('procesando');
    const missing = await withRaw(RAW_404, () => handleGetConversation(get('/x'), { conversationId: ID }));
    expect(missing.result.status).toBe(404);
    expect(await missing.result.text()).toBe(JSON.stringify({ error: 'conversation_not_found' }));
    expect(NOT_FOUND_BODY).toContain('message');
  });
});

describe('FRANCA_API_URL inválida en ejecución', () => {
  it('cada ruta responde 500 internal_error y registra una línea con el nombre de la variable, sin el valor', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const previous = process.env.FRANCA_API_URL;
    process.env.FRANCA_API_URL = 'http://api.example.com:3001';
    try {
      const response = await handleGetConversation(get('/x'), { conversationId: ID });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'internal_error' });
      const lines = spy.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line.includes('FRANCA_API_URL'))).toBe(true);
      for (const line of lines) expect(line).not.toContain('api.example.com');
      expect(lines.join('\n')).not.toContain(ID);
    } finally {
      process.env.FRANCA_API_URL = previous;
    }
  });

  it('un 5xx registra solo la plantilla, el estado y el código, nunca la ruta real ni datos', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.api.respond((_request, response) => sendJson(response, 503, { message: 'MARCA-MENSAJE', error: 'database_unavailable' }));
    await handleSendInput(post(`/api/conversations/${ID}/inputs`, '{"input":{"text":"MARCA-NOMBRE"}}', { 'If-Match': '"1"' }), { conversationId: ID });
    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual(['[web] POST /api/conversations/[conversationId]/inputs 503 database_unavailable']);
  });
});
