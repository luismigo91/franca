import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hola, pregunta, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

describe('leer y listar conversaciones (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('Conversación que no existe', async () => {
    await ctx.publish(hola());
    const { id } = await ctx.start('hola');
    for (const path of ['00000000-0000-4000-8000-000000000000', 'no-es-un-uuid', id.toUpperCase()]) {
      const res = await ctx.conv.get(path).expect(404);
      expect(res.body, path).toEqual({ message: expect.any(String), error: 'conversation_not_found' });
    }
    await ctx.conv.get(id).expect(200);
  });

  it('Filtros', async () => {
    await ctx.publish(hola());
    await ctx.publish(pregunta());
    await ctx.start('hola');
    await ctx.start('hola');
    const waiting = await ctx.start('pregunta');

    const byFlow = await ctx.conv.list('?flowId=pregunta').expect(200);
    expect(byFlow.body.total).toBe(1);
    expect(byFlow.body.items).toHaveLength(1);
    expect(byFlow.body.items[0].id).toBe(waiting.id);
    expect(byFlow.body.items[0]).not.toHaveProperty('pendingInput');
    expect((await ctx.conv.list('?status=ended').expect(200)).body.total).toBe(2);
    expect((await ctx.conv.list('?flowId=hola&status=waiting').expect(200)).body.total).toBe(0);
  });

  it('Una entrada sube la conversación al principio', async () => {
    await ctx.publish(hola());
    await ctx.publish(pregunta());
    const waiting = await ctx.start('pregunta');
    ctx.testApp.clock.advance(1000);
    await ctx.start('hola');
    ctx.testApp.clock.advance(1000);
    const newest = await ctx.start('hola');
    expect((await ctx.conv.list().expect(200)).body.items[0].id).toBe(newest.id);

    ctx.testApp.clock.advance(1000);
    await ctx.say(waiting.id, { text: 'Ana' });
    const items = (await ctx.conv.list().expect(200)).body.items;
    expect(items[0].id).toBe(waiting.id);
    expect(items).toHaveLength(3);
  });

  it('a igualdad de updatedAt, id ascendente; y se pagina', async () => {
    await ctx.publish(hola());
    const ids = [(await ctx.start('hola')).id, (await ctx.start('hola')).id, (await ctx.start('hola')).id];
    await ctx.prisma.$executeRaw`UPDATE conversations SET updated_at = '2026-10-17T12:00:00.000Z'`;
    const sorted = [...ids].sort();
    const all = (await ctx.conv.list().expect(200)).body;
    expect(all.items.map((item: any) => item.id)).toEqual(sorted);
    const page = (await ctx.conv.list('?limit=1&offset=1').expect(200)).body;
    expect(page).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(page.items.map((item: any) => item.id)).toEqual([sorted[1]]);
  });

  it('el listado incluye las conversaciones de flujos borrados', async () => {
    await ctx.publish(pregunta());
    await ctx.start('pregunta');
    await ctx.flows.remove('pregunta').expect(204);
    expect((await ctx.conv.list().expect(200)).body.total).toBe(1);
  });

  it('Parámetros del listado no admitidos', async () => {
    for (const query of ['?status=activa', '?flowId=Hola', '?status=ended&status=failed', '?limit=101', '?offset=-1']) {
      const res = await ctx.conv.list(query).expect(400);
      expect(res.body, query).toEqual({ message: expect.any(String), error: 'invalid_query' });
    }
    await ctx.conv.list('?orden=fecha').expect(200);
  });
});
