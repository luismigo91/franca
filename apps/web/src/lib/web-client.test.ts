import { describe, expect, it } from 'vitest';
import { createWebClient } from '@/lib/web-client';

interface Call {
  url: string;
  init: RequestInit;
}

const CONVERSATION = {
  id: '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90',
  flowId: 'pregunta',
  version: 1,
  contactId: null,
  status: 'waiting',
  revision: 1,
  processing: false,
  pendingInput: { type: 'input', nodeId: 'p', inputType: 'text', attempt: 1, reason: null },
  outcome: null,
  error: null,
  costUsd: 0,
  costLimitReached: false,
  createdAt: '2026-10-17T10:30:00.000Z',
  updatedAt: '2026-10-17T10:30:00.000Z',
  expiresAt: '2026-10-18T10:30:00.000Z',
};

function setup(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const client = createWebClient(async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
  return { calls, client };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('web-client', () => {
  it('un 204 es un éxito sin cuerpo', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));
    expect(await client.deleteConversation(CONVERSATION.id)).toEqual({ ok: true, status: 204, body: null });
  });

  it.each([403, 405, 500, 502])('un %i sin cuerpo se lee por su estado y es unknown, nunca network_error', async (status) => {
    const { client } = setup(() => new Response(null, { status }));
    expect(await client.getConversation(CONVERSATION.id)).toEqual({ ok: false, status, code: 'unknown' });
    expect(await client.deleteConversation(CONVERSATION.id)).toEqual({ ok: false, status, code: 'unknown' });
  });

  it('un 4xx con un cuerpo que no es JSON o no tiene error legible es unknown', async () => {
    for (const text of ['<html>no</html>', '[]', '{"error":3}', '{"error":"Mayúsculas"}', '{"mensaje":"x"}', 'null']) {
      const { client } = setup(() => new Response(text, { status: 409 }));
      expect(await client.getConversation(CONVERSATION.id), text).toEqual({ ok: false, status: 409, code: 'unknown' });
    }
  });

  it('un 4xx con un error conocido lo devuelve, y uno desconocido es unknown', async () => {
    expect(await setup(() => json(409, { error: 'conversation_busy' })).client.getConversation(CONVERSATION.id)).toEqual({ ok: false, status: 409, code: 'conversation_busy' });
    expect(await setup(() => json(502, { error: 'api_unreachable' })).client.getConversation(CONVERSATION.id)).toEqual({ ok: false, status: 502, code: 'api_unreachable' });
    expect(await setup(() => json(409, { error: 'codigo_nuevo' })).client.getConversation(CONVERSATION.id)).toEqual({ ok: false, status: 409, code: 'unknown' });
    expect(await setup(() => json(409, { error: 'constructor' })).client.getConversation(CONVERSATION.id)).toEqual({ ok: false, status: 409, code: 'unknown' });
  });

  it('un 412 trae currentRevision', async () => {
    const { client } = setup(() => json(412, { error: 'revision_mismatch', currentRevision: 2 }));
    expect(await client.sendInput(CONVERSATION.id, { text: 'Ana' }, 1)).toEqual({ ok: false, status: 412, code: 'revision_mismatch', currentRevision: 2 });
  });

  it('un 2xx sin JSON es invalid_api_response', async () => {
    for (const body of ['', 'no es json']) {
      const { client } = setup(() => new Response(body, { status: 200 }));
      expect(await client.getConversation(CONVERSATION.id), body).toEqual({ ok: false, status: 200, code: 'invalid_api_response' });
    }
  });

  it('un 2xx con JSON que no tiene la forma esperada es invalid_api_response', async () => {
    const { client } = setup(() => json(200, { id: 3 }));
    expect(await client.getConversation(CONVERSATION.id)).toEqual({ ok: false, status: 200, code: 'invalid_api_response' });
  });

  it('network_error solo con un fetch rechazado, abortado o un cuerpo que se corta', async () => {
    const rejected = createWebClient(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await rejected.getConversation(CONVERSATION.id)).toEqual({ ok: false, status: null, code: 'network_error' });

    const aborted = new AbortController();
    aborted.abort();
    const { client } = setup(() => json(200, CONVERSATION));
    expect(await client.getConversation(CONVERSATION.id, aborted.signal)).toEqual({ ok: false, status: null, code: 'network_error' });

    const cut = createWebClient(async () => {
      const stream = new ReadableStream({ pull: (controller) => controller.error(new Error('cortado')) });
      return new Response(stream, { status: 200 });
    });
    expect(await cut.getConversation(CONVERSATION.id)).toEqual({ ok: false, status: null, code: 'network_error' });
  });

  it('el plazo agotado aborta la llamada y es network_error', async () => {
    const hanging = createWebClient((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')))));
    const started = Date.now();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    expect(await hanging.getConversation(CONVERSATION.id, controller.signal)).toEqual({ ok: false, status: null, code: 'network_error' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('pide sin caché, en modo cors (sin mode) y con las credenciales del mismo origen', async () => {
    const { client, calls } = setup(() => json(200, CONVERSATION));
    await client.getConversation(CONVERSATION.id);
    expect(calls[0]!.url).toBe(`/api/conversations/${CONVERSATION.id}`);
    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect('mode' in calls[0]!.init).toBe(false);
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('las entradas llevan If-Match con la revisión entre comillas y el cuerpo exacto', async () => {
    const { client, calls } = setup(() => json(200, { conversation: CONVERSATION, events: [] }));
    await client.sendInput(CONVERSATION.id, { text: ' Ana ' }, 7);
    expect(calls[0]!.url).toBe(`/api/conversations/${CONVERSATION.id}/inputs`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toEqual({ 'Content-Type': 'application/json', 'If-Match': '"7"' });
    expect(calls[0]!.init.body).toBe('{"input":{"text":" Ana "}}');
  });

  it("un contacto '' manda {flowId} sin contactId, y ' ' lo manda tal cual", async () => {
    const { client, calls } = setup(() => json(201, { conversation: CONVERSATION, events: [] }));
    await client.createConversation('captacion-leads', '');
    await client.createConversation('captacion-leads', ' ');
    await client.createConversation('captacion-leads', 'c-1');
    expect(calls.map((call) => call.init.body)).toEqual(['{"flowId":"captacion-leads"}', '{"flowId":"captacion-leads","contactId":" "}', '{"flowId":"captacion-leads","contactId":"c-1"}']);
    expect(calls[0]!.url).toBe('/api/conversations');
  });

  it('lee las listas y ofrece las URL del catálogo', async () => {
    const { client, calls } = setup((call) =>
      call.url.startsWith('/api/flows')
        ? json(200, { items: [{ id: 'hola', name: 'Hola', revision: 1, latestVersion: 1, unpublishedChanges: false, createdAt: 'a', updatedAt: 'b' }, { roto: true }], total: 21, limit: 20, offset: 20 })
        : json(200, { items: [], total: 0, limit: 20, offset: 0 }),
    );
    const flows = await client.listFlows(20);
    expect(flows.ok && flows.body.items.map((flow) => flow.id)).toEqual(['hola']);
    expect(flows.ok && flows.body.total).toBe(21);
    await client.listConversations(40);
    await client.getTranscriptPage(CONVERSATION.id, 100);
    await client.getFlowVersion('captacion-leads', 2);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/flows?offset=20',
      '/api/conversations?offset=40',
      `/api/conversations/${CONVERSATION.id}/transcript?offset=100`,
      '/api/flows/captacion-leads/versions/2',
    ]);
  });
});
