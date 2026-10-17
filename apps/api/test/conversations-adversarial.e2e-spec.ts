import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Deferred } from './helpers/conversations-llm.js';
import { hookedRepositoryOf, withHookedRepository, type HookedConversationsRepository } from './helpers/conversations-repository.js';
import { leads, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

function run(test: Test): Promise<Response> {
  return new Promise((resolve, reject) => void test.then(resolve, reject));
}

/** Un flujo que se queda en bucle esperando texto: cada entrada añade tres entradas a la transcripción (la suya, un mensaje y el `input`). */
const eco = () => ({
  specVersion: '0.1',
  id: 'eco',
  name: 'Eco',
  variables: [{ name: 'x', type: 'string' }],
  start: 'p',
  nodes: [
    { id: 'p', type: 'input', inputType: 'text', variable: 'x', prompt: [{ kind: 'text', text: 'Dime algo' }], next: 'c' },
    { id: 'c', type: 'condition', rules: [{ when: { variable: 'x', op: 'eq', value: 'fin' }, next: 'fin' }], else: 'm' },
    { id: 'm', type: 'message', content: [{ kind: 'text', text: 'Eco: {{x}}' }], next: 'p' },
    { id: 'fin', type: 'end' },
  ],
});

describe('costuras entre peticiones (e2e)', () => {
  let ctx: ConversationsContext;
  let repository: HookedConversationsRepository;

  beforeAll(async () => {
    ctx = await startConversationsContext({ configure: withHookedRepository });
    repository = hookedRepositoryOf(ctx.testApp.app);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    repository.clear();
    await ctx.reset();
  });

  it('dos creaciones simultáneas del mismo contacto nuevo comparten una sola fila de contacto', async () => {
    await ctx.publish(leads());
    const [a, b] = await Promise.all([run(ctx.conv.create({ flowId: 'captacion-leads', contactId: 'c-nuevo' })), run(ctx.conv.create({ flowId: 'captacion-leads', contactId: 'c-nuevo' }))]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.conversation.id).not.toBe(b.body.conversation.id);
    expect(await ctx.prisma.contact.count({ where: { id: 'c-nuevo' } })).toBe(1);
    expect(await ctx.prisma.conversation.count({ where: { contactId: 'c-nuevo' } })).toBe(2);
  });

  it('DELETE /contacts repetido durante un avance: todos 204 y el avance se aplica antes del borrado', async () => {
    await ctx.publish(leads());
    const { id } = await ctx.start('captacion-leads', { contactId: 'c-1' });
    const locked = new Deferred();
    const release = new Deferred();
    repository.onLocked = async (step) => {
      if (step !== 'apply') return;
      locked.resolve();
      await release.promise;
    };
    const sending = run(ctx.conv.send(id, { input: { text: 'Ana' } }));
    await locked.promise;
    const deletes = [run(ctx.conv.removeContact('c-1')), run(ctx.conv.removeContact('c-1')), run(ctx.conv.removeContact('c-1'))];
    await new Promise((resolve) => setTimeout(resolve, 200));
    release.resolve();
    const responses = await Promise.all([sending, ...deletes]);
    expect(responses.map((res) => res.status)).toEqual([200, 204, 204, 204]);
    await ctx.conv.get(id).expect(404);
    await ctx.conv.removeContact('c-1').expect(204);
  });

  it('una conversación de más de 200 entradas se lista, se lee paginada y se borra en segundos', async () => {
    await ctx.publish(eco());
    const { id } = await ctx.start('eco');
    for (let round = 0; round < 70; round += 1) await ctx.say(id, { text: `mensaje ${round}` });
    const timed = async <T>(label: string, action: () => PromiseLike<T>): Promise<T> => {
      const started = performance.now();
      const value = await action();
      expect(performance.now() - started, label).toBeLessThan(10_000);
      return value;
    };
    const list = await timed('listar', () => ctx.conv.list().expect(200));
    expect(list.body.items[0]).toMatchObject({ id, revision: 71 });
    const page = await timed('transcripción', () => ctx.conv.transcript(id, '?limit=100&offset=100').expect(200));
    expect(page.body.total).toBeGreaterThan(200);
    expect(page.body.items).toHaveLength(100);
    expect(page.body.items[0].seq).toBe(101);
    await timed('borrar', () => ctx.conv.remove(id).expect(204));
    expect(await ctx.prisma.conversationEntry.count({ where: { conversationId: id } })).toBe(0);
  });
});
