import { describe, expect, it } from 'vitest';
import { createEditorClient } from '@/lib/web-client';
import { FLOW_BODY, FLOW_UPDATED_BODY, LIST_BODY, VERSION_BODY } from '../../tests/helpers/real-flow-shapes';

interface Call {
  url: string;
  init: RequestInit;
}

/** Un `fetch` falso con guion: cada llamada se registra y responde lo que toca. */
function fakeFetch(...replies: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const reply = replies.length > 1 ? replies.shift()! : replies[0]!;
    if (reply instanceof Error) throw reply;
    return reply.clone();
  };
  return { calls, client: createEditorClient(fetchImpl) };
}

const json = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'application/json' } });

describe('createEditorClient', () => {
  it('la lista: GET /api/editor/flows?offset=N, sin cuerpo, en modo cors y sin caché', async () => {
    const { calls, client } = fakeFetch(json(200, LIST_BODY));
    const result = await client.listFlows(40);
    expect(calls[0]!.url).toBe('/api/editor/flows?offset=40');
    expect(calls[0]!.init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin' });
    expect(calls[0]!.init.body).toBeUndefined();
    expect('mode' in calls[0]!.init).toBe(false);
    expect(result).toMatchObject({ ok: true, status: 200, body: { total: 1, items: [{ id: 'hola', name: 'Hola', latestVersion: null }] } });
  });

  it('leer: GET /api/editor/flows/:id con el id codificado', async () => {
    const { calls, client } = fakeFetch(json(200, FLOW_BODY));
    const result = await client.getFlow('hola');
    expect(calls[0]!.url).toBe('/api/editor/flows/hola');
    expect(result.ok && result.body.flow.start).toBe('fin');
    await client.getFlow('a/b');
    expect(calls[1]!.url).toBe('/api/editor/flows/a%2Fb');
  });

  it('crear: POST /api/editor/flows con el texto tal cual y Content-Type, sin If-Match', async () => {
    const { calls, client } = fakeFetch(json(201, FLOW_BODY));
    const result = await client.createFlow('{"id":"hola"}');
    expect(calls[0]!.url).toBe('/api/editor/flows');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', body: '{"id":"hola"}', headers: { 'Content-Type': 'application/json' } });
    expect(calls[0]!.init.headers).not.toHaveProperty('If-Match');
    expect(result).toMatchObject({ ok: true, status: 201 });
  });

  it('guardar: PUT con If-Match: "<revision>" y el texto', async () => {
    const { calls, client } = fakeFetch(json(200, FLOW_UPDATED_BODY));
    const result = await client.updateFlow('hola', '{"a":1}', 7);
    expect(calls[0]!.url).toBe('/api/editor/flows/hola');
    expect(calls[0]!.init).toMatchObject({ method: 'PUT', body: '{"a":1}', headers: { 'Content-Type': 'application/json', 'If-Match': '"7"' } });
    expect(result.ok && result.body.revision).toBe(2);
  });

  it('publicar: POST …/versions con If-Match y sin cuerpo; 201 y 200 se distinguen por el estado', async () => {
    const { calls, client } = fakeFetch(json(201, VERSION_BODY), json(200, VERSION_BODY));
    const first = await client.publishFlow('hola', 2);
    const second = await client.publishFlow('hola', 2);
    expect(calls[0]!.url).toBe('/api/editor/flows/hola/versions');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', headers: { 'If-Match': '"2"' } });
    expect(calls[0]!.init.body).toBeUndefined();
    expect(first).toMatchObject({ ok: true, status: 201, body: { version: 1 } });
    expect(second).toMatchObject({ ok: true, status: 200 });
  });

  it('borrar: DELETE con If-Match; el 204 es éxito', async () => {
    const { calls, client } = fakeFetch(new Response(null, { status: 204 }));
    const result = await client.deleteFlow('hola', 3);
    expect(calls[0]!.url).toBe('/api/editor/flows/hola');
    expect(calls[0]!.init).toMatchObject({ method: 'DELETE', headers: { 'If-Match': '"3"' } });
    expect(result).toEqual({ ok: true, status: 204, body: null });
  });

  it('un 412 trae currentRevision; un 404 y un 409 traen su código', async () => {
    const { client } = fakeFetch(json(412, '{"error":"revision_mismatch","currentRevision":4}'), json(404, '{"error":"flow_not_found"}'), json(409, '{"error":"flow_id_reserved"}'));
    expect(await client.updateFlow('hola', '{}', 1)).toEqual({ ok: false, status: 412, code: 'revision_mismatch', currentRevision: 4 });
    expect(await client.getFlow('hola')).toEqual({ ok: false, status: 404, code: 'flow_not_found' });
    expect(await client.createFlow('{}')).toEqual({ ok: false, status: 409, code: 'flow_id_reserved' });
  });

  it('un 4xx sin cuerpo (el 403 de la frontera) es unknown con su estado, nunca network_error', async () => {
    const { client } = fakeFetch(new Response(null, { status: 403 }));
    expect(await client.updateFlow('hola', '{}', 1)).toEqual({ ok: false, status: 403, code: 'unknown' });
  });

  it('network_error solo con un fetch rechazado', async () => {
    const { client } = fakeFetch(new TypeError('Failed to fetch'));
    expect(await client.getFlow('hola')).toEqual({ ok: false, status: null, code: 'network_error' });
  });

  it('un 2xx con otra forma es invalid_api_response', async () => {
    const { client } = fakeFetch(json(200, '{"id":"hola"}'));
    expect(await client.getFlow('hola')).toEqual({ ok: false, status: 200, code: 'invalid_api_response' });
    const bad = fakeFetch(json(201, '{"version":"1"}'));
    expect(await bad.client.publishFlow('hola', 1)).toMatchObject({ ok: false, code: 'invalid_api_response' });
  });
});
