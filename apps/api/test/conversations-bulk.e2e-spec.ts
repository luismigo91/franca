import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

const VARIABLES = 13_000;

function run(test: Test): Promise<Response> {
  return new Promise((resolve, reject) => void test.then(resolve, reject));
}

/** Un flujo cercano a 1 MiB que asigna miles de variables de contacto (una de ellas llamada `__proto__`) en un solo avance. */
function bulkFlow() {
  const names = [...Array.from({ length: VARIABLES }, (_, index) => `v${index.toString(36)}`), '__proto__'];
  return {
    specVersion: '0.1',
    id: 'masivo',
    name: 'Masivo',
    variables: names.map((name) => ({ name, type: 'json', scope: 'contact' })),
    start: 's',
    nodes: [
      { id: 's', type: 'set', assignments: names.map((variable) => ({ variable, value: 1 })), next: 'fin' },
      { id: 'fin', type: 'end' },
    ],
  };
}

describe('muchos valores de contacto en un avance (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('se guardan todos por lotes, __proto__ incluido, y un borrado lanzado a mitad responde 204', async () => {
    const flow = bulkFlow();
    expect(Buffer.byteLength(JSON.stringify(flow))).toBeLessThan(1_048_576);
    await ctx.publish(flow);

    const creating = run(ctx.conv.create({ flowId: 'masivo', contactId: 'c-masivo' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const deleted = await ctx.conv.removeContact('c-masivo');
    expect(deleted.status).toBe(204);
    const created = await creating;
    // El borrado puede ganar a la creación (404) o llegar después; nunca un 5xx.
    expect([201, 404]).toContain(created.status);

    // Sin borrado: se guardan todos.
    const again = await ctx.conv.create({ flowId: 'masivo', contactId: 'c-masivo-2' }).expect(201);
    expect(again.body.conversation.status).toBe('ended');
    expect(await ctx.prisma.contactValue.count({ where: { contactId: 'c-masivo-2' } })).toBe(VARIABLES + 1);
    const proto = await ctx.prisma.contactValue.findUnique({ where: { contactId_name: { contactId: 'c-masivo-2', name: '__proto__' } } });
    expect(proto?.valueJson).toBe('1');
  });
});
