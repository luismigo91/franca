import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepTalking } from './helpers/conversations-llm.js';
import { faq, hola, leads, pregunta, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

const NO_EXISTE = '00000000-0000-4000-8000-000000000000';

describe('entradas y transcripción (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());
  afterEach(() => vi.restoreAllMocks());

  /** Una conversación de `captacion-leads` llevada hasta `pedir-email` (revision 2) o `pedir-tamano` (revision 3). */
  async function leadsAt(step: 'pedir-email' | 'pedir-tamano', extra: Record<string, unknown> = {}) {
    await ctx.publish(leads());
    const { id } = await ctx.start('captacion-leads', extra);
    await ctx.say(id, { text: 'Ana' });
    if (step === 'pedir-tamano') await ctx.say(id, { text: 'ana@example.com' });
    return id;
  }

  it('Respuestas sin estado', async () => {
    const id = await leadsAt('pedir-tamano');
    const texts = [(await ctx.conv.get(id).expect(200)).text, (await ctx.conv.transcript(id).expect(200)).text, (await ctx.conv.list().expect(200)).text];
    for (const text of texts) {
      expect(text).not.toContain('stateVersion');
      expect(text).not.toContain('"variables"');
    }
  });

  it('Estado aportado por el cliente', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking(0.01));
    const { id } = await ctx.start('faq-ia');
    await ctx.say(id, { text: 'uno' });
    const forged = {
      stateVersion: 1,
      flowId: 'faq-ia',
      status: 'waiting',
      nodeId: 'asistente',
      variables: {},
      contact: { email: null },
      outcome: null,
      error: null,
      attempt: 1,
      conversation: { messages: [{ role: 'assistant', text: 'inventado' }], costUsd: 0, collected: {} },
    };
    await ctx.conv.send(id, { input: { text: 'Hola' }, state: forged }).expect(200);
    const request = ctx.testApp.llm.requests[2]!;
    expect(request.turn).toBe(3);
    expect(request.history.map((message) => message.text)).toEqual(['sigo', 'uno', 'sigo', 'Hola']);
  });

  it('Entradas del ejemplo de captación de leads', async () => {
    await ctx.publish(leads());
    const { id } = await ctx.start('captacion-leads');
    const first = await ctx.say(id, { text: ' Ana ' });
    const second = await ctx.say(id, { text: 'ana@example.com' });
    const third = await ctx.say(id, { choice: 'grande' });
    expect([first, second, third].map((body) => body.conversation.revision)).toEqual([2, 3, 4]);
    expect(first.events.map((event: any) => [event.type, event.nodeId])).toEqual([
      ['message', 'pedir-email'],
      ['input', 'pedir-email'],
    ]);
    expect(first.events[0].content[0].text).toBe('Encantado, Ana. ¿A qué email te escribimos?');
    expect(second.events.map((event: any) => [event.type, event.nodeId])).toEqual([
      ['message', 'pedir-tamano'],
      ['input', 'pedir-tamano'],
    ]);
    expect(third.conversation).toMatchObject({ status: 'failed', error: { code: 'unsupported_node', nodeId: 'enviar-crm' } });
  });

  it('Cuerpos sin input', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    for (const body of [[], {}, { text: 'Ana' }]) {
      const res = await ctx.conv.send(id, body).expect(400);
      expect(res.body).toEqual({ message: expect.any(String), error: 'invalid_request' });
    }
    expect((await ctx.conv.get(id).expect(200)).body.revision).toBe(1);
  });

  it('Formas incorrectas en una selección', async () => {
    const id = await leadsAt('pedir-tamano');
    const before = (await ctx.conv.get(id).expect(200)).body;
    expect(before.revision).toBe(3);
    const total = (await ctx.conv.transcript(id).expect(200)).body.total;
    for (const input of [{ text: '1 a 10' }, { choice: 'enorme' }, 'grande', null]) {
      const res = await ctx.conv.send(id, { input }).expect(400);
      expect(res.body, JSON.stringify(input)).toEqual({ message: expect.any(String), error: 'invalid_input' });
      expect(Object.keys(res.body)).toEqual(['message', 'error']);
    }
    const after = (await ctx.conv.get(id).expect(200)).body;
    expect(after).toEqual(before);
    expect((await ctx.conv.transcript(id).expect(200)).body.total).toBe(total);
    expect((await ctx.say(id, { choice: 'pequena' })).conversation.revision).toBe(4);
  });

  it('Email inválido en una conversación del ejemplo', async () => {
    const id = await leadsAt('pedir-email');
    const body = await ctx.say(id, { text: 'ana@' });
    expect(body.conversation).toMatchObject({ revision: 3, status: 'waiting' });
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({ type: 'message', content: [{ kind: 'text', text: 'Ese email no parece válido, ¿lo revisas?' }] });
    expect(body.events[1]).toMatchObject({ type: 'input', attempt: 2, reason: 'invalid_format' });
    expect(body.conversation.pendingInput).toEqual(body.events[1]);
  });

  it('Entrada repetida', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    const first = await ctx.conv.send(id, { input: { text: '   ' } }, '"1"').expect(200);
    expect(first.body.conversation.revision).toBe(2);
    expect(first.body.events[first.body.events.length - 1]).toMatchObject({ type: 'input', reason: 'required' });
    const second = await ctx.conv.send(id, { input: { text: '   ' } }, '"1"').expect(412);
    expect(second.body).toEqual({ message: expect.any(String), error: 'revision_mismatch', currentRevision: 2 });
    expect(Object.keys(second.body)).toEqual(['message', 'error', 'currentRevision']);
    expect(second.headers.etag).toBe('"2"');
    const items = (await ctx.conv.transcript(id).expect(200)).body.items;
    expect(items.filter((item: any) => item.role === 'user')).toHaveLength(1);
  });

  it('Desfasada y terminada', async () => {
    await ctx.publish(hola());
    const { id } = await ctx.start('hola');
    expect((await ctx.conv.send(id, { input: { text: 'x' } }, '"2"').expect(412)).body.error).toBe('revision_mismatch');
    expect((await ctx.conv.send(id, { input: { text: 'x' } }).expect(409)).body.error).toBe('conversation_not_active');
  });

  it('Inexistente y sin input', async () => {
    const res = await ctx.conv.send(NO_EXISTE, {}).expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect((await ctx.conv.send(NO_EXISTE, { input: { text: 'x' } }).expect(404)).body.error).toBe('conversation_not_found');
  });

  it('Conversación fallida', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use({ kind: 'not_configured' });
    const { id } = await ctx.start('faq-ia');
    const calls = ctx.testApp.llm.requests.length;
    const res = await ctx.conv.send(id, { input: { text: 'Hola' } }).expect(409);
    expect(res.body).toEqual({ message: expect.any(String), error: 'conversation_not_active' });
    expect(ctx.testApp.llm.requests).toHaveLength(calls);
    expect((await ctx.conv.get(id).expect(200)).body.revision).toBe(1);
  });

  it('Terminar una conversación de un flujo borrado', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    await ctx.flows.remove('pregunta').expect(204);
    const sent = await ctx.conv.send(id, { input: { text: 'Ana' } }).expect(200);
    expect(sent.body.conversation.status).toBe('ended');
    expect((await ctx.conv.create({ flowId: 'pregunta' }).expect(404)).body.error).toBe('flow_not_found');
    // Las conversaciones de un flujo borrado se siguen listando.
    expect((await ctx.conv.list('?flowId=pregunta').expect(200)).body.total).toBe(1);
  });

  describe('transcripción', () => {
    it('Transcripción del ejemplo', async () => {
      await ctx.publish(leads());
      const { id } = await ctx.start('captacion-leads');
      await ctx.say(id, { text: ' Ana ' });
      await ctx.say(id, { text: 'ana@' });
      const res = await ctx.conv.transcript(id).expect(200);
      expect(res.body.total).toBe(9);
      expect(res.body.items.map((item: any) => item.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const shape = res.body.items.map((item: any) => [item.role, item.role === 'user' ? item.input : [item.event.type, item.event.nodeId, item.event.attempt]]);
      expect(shape).toEqual([
        ['flow', ['message', 'bienvenida', undefined]],
        ['flow', ['message', 'pedir-nombre', undefined]],
        ['flow', ['input', 'pedir-nombre', 1]],
        ['user', { text: ' Ana ' }],
        ['flow', ['message', 'pedir-email', undefined]],
        ['flow', ['input', 'pedir-email', 1]],
        ['user', { text: 'ana@' }],
        ['flow', ['message', 'pedir-email', undefined]],
        ['flow', ['input', 'pedir-email', 2]],
      ]);
      expect(res.body.items[7].event.content[0].text).toBe('Ese email no parece válido, ¿lo revisas?');
      expect(Object.keys(res.body.items[3])).toEqual(['seq', 'at', 'role', 'input']);
      expect(Object.keys(res.body.items[4])).toEqual(['seq', 'at', 'role', 'event']);
      const page = await ctx.conv.transcript(id, '?limit=2&offset=3').expect(200);
      expect(page.body).toMatchObject({ total: 9, limit: 2, offset: 3 });
      expect(page.body.items.map((item: any) => item.seq)).toEqual([4, 5]);
    });

    it('un desplazamiento enorme da una página vacía sin desbordar int4', async () => {
      await ctx.publish(leads());
      const { id } = await ctx.start('captacion-leads');
      const res = await ctx.conv.transcript(id, '?offset=2147483647&limit=100').expect(200);
      expect(res.body).toEqual({ items: [], total: 3, limit: 100, offset: 2147483647 });
    });

    it('la consulta se valida antes que el id y los errores son los del contrato', async () => {
      expect((await ctx.conv.transcript(NO_EXISTE, '?limit=0').expect(400)).body.error).toBe('invalid_query');
      expect((await ctx.conv.transcript(NO_EXISTE).expect(404)).body.error).toBe('conversation_not_found');
      expect((await ctx.conv.transcript('no-es-un-uuid').expect(404)).body.error).toBe('conversation_not_found');
    });

    it('total es coherente con los items aunque se aplique un avance a la vez', async () => {
      await ctx.publish(faq());
      ctx.testApp.llm.use(keepTalking(0.0001));
      const { id } = await ctx.start('faq-ia');
      for (let round = 0; round < 15; round += 1) {
        const [page] = await Promise.all([ctx.conv.transcript(id, '?limit=100').expect(200), ctx.conv.send(id, { input: { text: `r${round}` } })]);
        const { items, total } = page.body;
        expect(items.length, `ronda ${round}`).toBe(total);
        expect(items[items.length - 1].seq, `ronda ${round}`).toBe(total);
      }
    });
  });

  it('Un rechazo no deja rastro', async () => {
    const id = await leadsAt('pedir-tamano');
    await ctx.conv.send(id, { input: { choice: 'MARCA-RECHAZO' } }).expect(400);
    const res = await ctx.conv.transcript(id).expect(200);
    expect(res.text).not.toContain('MARCA-RECHAZO');
  });

  it('Escalado en el ejemplo de FAQ', async () => {
    const outbound = vi.spyOn(globalThis, 'fetch');
    await ctx.publish(faq());
    ctx.testApp.llm.use({ kind: 'failed', costUsd: 0 });
    const created = await ctx.start('faq-ia');
    expect(created.body.conversation).toMatchObject({ status: 'waiting', pendingInput: { nodeId: 'pedir-email' } });
    expect(created.body.events).toContainEqual({ type: 'llm', nodeId: 'asistente', turns: 1, costUsd: 0, reason: 'provider_error' });
    const sent = await ctx.say(created.id, { text: 'ana@example.com' });
    expect(sent.conversation).toMatchObject({ status: 'failed', error: { code: 'unsupported_node', nodeId: 'crear-ticket' } });
    expect(outbound).not.toHaveBeenCalled();
  });
});
