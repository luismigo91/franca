import { startSession } from '@franca/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { faq, hola, leads, pregunta, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RESOURCE_KEYS = ['id', 'flowId', 'version', 'contactId', 'status', 'revision', 'processing', 'pendingInput', 'outcome', 'error', 'costUsd', 'costLimitReached', 'createdAt', 'updatedAt', 'expiresAt'];

describe('crear conversaciones (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('Publicar otra versión no cambia la conversación', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    const changed = pregunta();
    changed.nodes[0].prompt[0].text = '¿Cómo te llamas?';
    await ctx.republish(changed);

    const sent = await ctx.say(id, { text: 'Ana' });
    expect(sent.conversation).toMatchObject({ version: 1, status: 'ended', outcome: 'ok' });

    const fresh = await ctx.start('pregunta');
    expect(fresh.body.conversation.version).toBe(2);
    expect(fresh.body.events[0]).toMatchObject({ type: 'message', content: [{ kind: 'text', text: '¿Cómo te llamas?' }] });
  });

  it('Crear con captacion-leads', async () => {
    await ctx.publish(leads());
    const res = await ctx.conv.create({ flowId: 'captacion-leads' }).expect(201);
    const { conversation, events } = res.body;
    expect(res.headers.location).toBe(`/conversations/${conversation.id}`);
    expect(res.headers.etag).toBe('"1"');
    expect(conversation).toEqual({
      id: expect.stringMatching(UUID_V4),
      flowId: 'captacion-leads',
      version: 1,
      contactId: null,
      status: 'waiting',
      revision: 1,
      processing: false,
      pendingInput: { type: 'input', nodeId: 'pedir-nombre', inputType: 'text', attempt: 1, reason: null },
      outcome: null,
      error: null,
      costUsd: 0,
      costLimitReached: false,
      createdAt: expect.any(String),
      updatedAt: conversation.createdAt,
      expiresAt: new Date(Date.parse(conversation.createdAt) + 1440 * 60_000).toISOString(),
    });
    // Los eventos son exactamente los que devuelve el motor.
    const engine = await startSession({ flow: leads() });
    if (!engine.ok) throw new Error('el motor rechazó el ejemplo');
    expect(events).toEqual(engine.events);
    expect(events.map((event: any) => [event.type, event.nodeId])).toEqual([
      ['message', 'bienvenida'],
      ['message', 'pedir-nombre'],
      ['input', 'pedir-nombre'],
    ]);
    expect(events[1].content[0].text).toBe('¿Cómo te llamas?');
  });

  it('Flujo que termina al crear', async () => {
    await ctx.publish(hola());
    const res = await ctx.conv.create({ flowId: 'hola' }).expect(201);
    expect(res.body.conversation).toMatchObject({ status: 'ended', outcome: null, pendingInput: null, expiresAt: null });
    expect(res.body.events).toEqual([{ type: 'end', nodeId: 'fin', outcome: null }]);
  });

  it('Flujo que falla al crear', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use({ kind: 'not_configured' });
    const res = await ctx.conv.create({ flowId: 'faq-ia' }).expect(201);
    expect(res.body.conversation).toMatchObject({ status: 'failed', error: { code: 'llm_not_configured', nodeId: 'asistente' }, pendingInput: null, expiresAt: null });
    expect(res.body.events.map((event: any) => event.type)).toEqual(['message', 'error']);
    expect(res.body.events[0]).toMatchObject({ nodeId: 'saludo' });
    expect(res.body.events[1]).toMatchObject({ type: 'error', code: 'llm_not_configured', nodeId: 'asistente' });
  });

  it('Cuerpos no válidos', async () => {
    await ctx.publish(hola());
    const bodies: unknown[] = [[], {}, { flowId: 5 }, { flowId: 'hola', version: '1' }, { flowId: 'hola', version: 0 }, { flowId: 'hola', version: 1.5 }, { flowId: 'hola', version: 2147483648 }, { flowId: 'hola', contactId: 7 }];
    for (const body of bodies) {
      const res = await ctx.conv.create(body as object).expect(400);
      expect(res.body, JSON.stringify(body)).toEqual({ message: expect.any(String), error: 'invalid_request' });
      expect(Object.keys(res.body)).toEqual(['message', 'error']);
    }
    expect((await ctx.conv.list().expect(200)).body.total).toBe(0);
  });

  it('Nulos y propiedades desconocidas', async () => {
    await ctx.publish(hola());
    const res = await ctx.conv.create({ flowId: 'hola', version: null, contactId: null, canal: 'web' }).expect(201);
    expect(res.body.conversation).toMatchObject({ version: 1, contactId: null });
  });

  it('Versión explícita', async () => {
    await ctx.publish(pregunta());
    const changed = pregunta();
    changed.nodes[0].prompt[0].text = '¿Cómo te llamas?';
    await ctx.republish(changed);
    const res = await ctx.conv.create({ flowId: 'pregunta', version: 1 }).expect(201);
    expect(res.body.conversation.version).toBe(1);
    expect(res.body.events[0]).toMatchObject({ type: 'message', content: [{ kind: 'text', text: '¿Nombre?' }] });
  });

  it('Flujo sin publicar', async () => {
    await ctx.flows.create(hola()).expect(201);
    expect((await ctx.conv.create({ flowId: 'hola' }).expect(409)).body).toEqual({ message: expect.any(String), error: 'flow_not_published' });
    expect((await ctx.conv.create({ flowId: 'hola', version: 1 }).expect(404)).body).toEqual({ message: expect.any(String), error: 'version_not_found' });
    expect((await ctx.conv.list().expect(200)).body.total).toBe(0);
  });

  it('Flujo inexistente o borrado', async () => {
    await ctx.publish(hola());
    await ctx.flows.remove('hola').expect(204);
    for (const body of [{ flowId: 'no-existe' }, { flowId: 'Hola' }, { flowId: 'hola' }, { flowId: 'hola', version: 1 }]) {
      const res = await ctx.conv.create(body).expect(404);
      expect(res.body, JSON.stringify(body)).toEqual({ message: expect.any(String), error: 'flow_not_found' });
    }
  });

  it('Cuerpo mal tipado de un flujo inexistente', async () => {
    const res = await ctx.conv.create({ flowId: 'no-existe', version: 'x' }).expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('Versión publicada con un validador anterior', async () => {
    await ctx.publish(hola());
    const broken = JSON.stringify({ ...hola(), start: 'no-existe' });
    await ctx.prisma.$executeRaw`UPDATE flow_versions SET definition = ${broken} WHERE flow_id = 'hola'`;
    const res = await ctx.conv.create({ flowId: 'hola' }).expect(409);
    expect(Object.keys(res.body)).toEqual(['message', 'error', 'issues']);
    expect(res.body.error).toBe('flow_version_invalid');
    expect(res.body.issues).toContainEqual(expect.objectContaining({ layer: 'semantic', path: '/start' }));
    expect((await ctx.conv.list().expect(200)).body.total).toBe(0);
  });

  it('Forma del resultado', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    const res = await ctx.conv.send(id, { input: { text: 'Ana' } }).expect(200);
    expect(res.headers.etag).toBe('"2"');
    expect(Object.keys(res.body)).toEqual(['conversation', 'events']);
    expect(res.body.events).toEqual([
      { type: 'message', nodeId: 'fin', content: [{ kind: 'text', text: 'Adiós, .' }], typingDelayMs: 600 },
      { type: 'end', nodeId: 'fin', outcome: 'ok' },
    ]);
  });

  it('Claves exactas', async () => {
    await ctx.publish(hola());
    const { id } = await ctx.start('hola');
    const res = await ctx.conv.get(id).expect(200);
    expect(Object.keys(res.body)).toEqual(RESOURCE_KEYS);
    expect(res.body.id).toMatch(UUID_V4);
    expect(res.headers.etag).toBe('"1"');
  });

  it('Fallo en el nodo http del ejemplo', async () => {
    await ctx.publish(leads());
    const { id } = await ctx.start('captacion-leads');
    await ctx.say(id, { text: 'Ana' });
    await ctx.say(id, { text: 'ana@example.com' });
    const body = await ctx.say(id, { choice: 'grande' });
    expect(body.conversation).toMatchObject({ status: 'failed', error: { code: 'unsupported_node', nodeId: 'enviar-crm' }, pendingInput: null });
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ type: 'error', code: 'unsupported_node', nodeId: 'enviar-crm' });
  });
});
