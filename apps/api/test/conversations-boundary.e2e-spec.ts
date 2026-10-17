import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hola, pregunta, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';
import { rawRequest } from './helpers/raw.js';

const KIB_64 = 65_536;
const MIB_1 = 1_048_576;

/** Un cuerpo JSON válido completado con espacios finales hasta `bytes` bytes exactos. */
function padded(json: object, bytes: number): string {
  const text = JSON.stringify(json);
  return text + ' '.repeat(bytes - Buffer.byteLength(text));
}

describe('frontera HTTP de las conversaciones (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('Entrada justo en el límite y por encima', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    const over = await ctx.conv.send(id, padded({ input: { text: '   ' } }, KIB_64 + 1)).expect(413);
    expect(over.body).toEqual({ message: 'el cuerpo supera el tamaño máximo de 64 KiB', error: 'payload_too_large' });
    expect(Object.keys(over.body)).toEqual(['message', 'error']);
    // No se continuó nada.
    expect((await ctx.conv.get(id).expect(200)).body.revision).toBe(1);
    const exact = await ctx.conv.send(id, padded({ input: { text: '   ' } }, KIB_64)).expect(200);
    expect(exact.body.conversation.revision).toBe(2);
  });

  it('Tamaño máximo del cuerpo de una conversación', async () => {
    await ctx.publish(hola());
    // POST /conversations, también con mayúsculas y barra final (el router de Express no las distingue).
    for (const path of ['/conversations', '/CONVERSATIONS', '/conversations/']) {
      const res = await rawRequest(ctx.testApp.port, { method: 'POST', path, headers: { 'content-type': 'application/json' }, body: padded({ flowId: 'hola' }, KIB_64 + 1) });
      expect(res.status, path).toBe(413);
      expect(res.json, path).toEqual({ message: 'el cuerpo supera el tamaño máximo de 64 KiB', error: 'payload_too_large' });
    }
    expect((await ctx.conv.list().expect(200)).body.total).toBe(0);
    const exact = await ctx.conv.create(padded({ flowId: 'hola' }, KIB_64)).expect(201);
    expect(exact.body.conversation.status).toBe('ended');

    // Las demás rutas conservan 1 MiB: un flujo de más de 64 KiB se acepta y uno de más de 1 MiB, no.
    const flow = { ...hola(), id: 'grande', name: 'Grande' };
    const accepted = await ctx.flows.create(padded(flow, KIB_64 + 1)).expect(201);
    expect(accepted.body.id).toBe('grande');
    const refused = await ctx.flows.create(padded(flow, MIB_1 + 1)).expect(413);
    expect(refused.body).toEqual({ message: 'el cuerpo supera el tamaño máximo de 1 MiB', error: 'payload_too_large' });
  });

  it('Sin cuerpo y texto plano', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    const empty = await ctx.conv.send(id, undefined).expect(400);
    expect(empty.body).toEqual({ message: expect.any(String), error: 'invalid_json' });
    const plain = await rawRequest(ctx.testApp.port, { method: 'POST', path: '/conversations', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ flowId: 'pregunta' }) });
    expect(plain.status).toBe(415);
    expect(plain.json).toEqual({ message: expect.any(String), error: 'unsupported_media_type' });
  });

  it('Navegador y Host ajeno', async () => {
    await ctx.publish(hola());
    const { id } = await ctx.start('hola', { contactId: 'c-1' });
    const origin = await rawRequest(ctx.testApp.port, {
      method: 'POST',
      path: '/conversations',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ flowId: 'hola' }),
    });
    expect(origin.status).toBe(403);
    expect(origin.json).toEqual({ message: expect.any(String), error: 'forbidden_origin' });
    const host = await rawRequest(ctx.testApp.port, { method: 'DELETE', path: '/contacts/c-1', headers: { host: 'evil.example:3001' } });
    expect(host.status).toBe(403);
    expect(host.json).toEqual({ message: expect.any(String), error: 'forbidden_host' });
    expect((await ctx.conv.list().expect(200)).body.total).toBe(1);
    await ctx.conv.get(id).expect(200);
  });

  it('las rutas de conversaciones no tienen CORS', async () => {
    await ctx.publish(hola());
    const res = await ctx.conv.list().expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Errores de las conversaciones', async () => {
    await ctx.publish(hola());
    const { id } = await ctx.start('hola');
    const missing = await ctx.conv.get('00000000-0000-4000-8000-000000000000').expect(404);
    const invalid = await ctx.conv.create({ flowId: 5 }).expect(400);
    const inactive = await ctx.conv.send(id, { input: { text: 'x' } }).expect(409);
    const shape = (code: string) => ({ message: expect.any(String), error: code });
    expect(missing.body).toEqual(shape('conversation_not_found'));
    expect(invalid.body).toEqual(shape('invalid_request'));
    expect(inactive.body).toEqual(shape('conversation_not_active'));
    for (const res of [missing, invalid, inactive]) expect(Object.keys(res.body)).toEqual(['message', 'error']);
  });
});
