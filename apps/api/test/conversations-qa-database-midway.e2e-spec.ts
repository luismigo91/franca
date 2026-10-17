import type { LlmTurnResult } from '@franca/engine';
import type { Response, Test } from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from 'vitest';
import { Deferred, keepTalking } from './helpers/conversations-llm.js';
import {
  faq,
  hola,
  pregunta,
  startConversationsContext,
  type ConversationsContext,
} from './helpers/conversations.js';
import {
  startDatabaseProxy,
  type DatabaseProxy,
} from './helpers/db-proxy.js';
import { captureOutput } from './helpers/output.js';

function run(test: Test): Promise<Response> {
  return new Promise((resolve, reject) => void test.then(resolve, reject));
}

const UNAVAILABLE = {
  message: expect.any(String),
  error: 'database_unavailable',
};

describe('QA: Postgres que cae o enmudece a mitad de un avance (e2e, con un proxy TCP)', () => {
  let proxy: DatabaseProxy;
  let ctx: ConversationsContext;
  const output = captureOutput();

  beforeAll(async () => {
    proxy = await startDatabaseProxy(inject('databaseUrl'));
    const url = new URL(inject('databaseUrl'));
    url.hostname = '127.0.0.1';
    url.port = String(proxy.port);
    ctx = await startConversationsContext({
      logger: output.logger,
      config: { databaseUrl: url.toString() },
    });
  });
  afterAll(async () => {
    proxy.mode = 'pass';
    await ctx.close();
    await proxy.close();
  });
  beforeEach(async () => {
    proxy.mode = 'pass';
    await ctx.reset();
  });
  afterEach(() => {
    proxy.mode = 'pass';
  });

  it('silencio entre reclamar y aplicar: 503 en menos de 10 s, sin 500; la conversación queda como antes y se recupera', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking());
    const faqConversation = await ctx.start('faq-ia');
    const slow = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => slow.promise);
    const sending = run(
      ctx.conv.send(faqConversation.id, { input: { text: 'uno' } }),
    );
    await ctx.testApp.llm.untilCalls(2);
    proxy.mode = 'freeze';
    slow.resolve(keepTalking());
    const started = performance.now();
    const res = await sending;
    const elapsed = performance.now() - started;
    expect(res.status, res.text).toBe(503);
    expect(res.body).toEqual(UNAVAILABLE);
    expect(elapsed).toBeLessThan(10_000);

    proxy.mode = 'pass';
    const after = (await ctx.conv.get(faqConversation.id).expect(200)).body;
    expect(after).toMatchObject({
      revision: 1,
      status: 'waiting',
      processing: true,
    });
    ctx.testApp.clock.advance(300_000);
    ctx.testApp.llm.use(keepTalking());
    await ctx.conv
      .send(faqConversation.id, { input: { text: 'uno' } })
      .expect(200);
    expect((await ctx.conv.get(id).expect(200)).body.revision).toBe(1);
    expect(
      output.lines().filter((line) => /password|postgresql:\/\//i.test(line)),
    ).toEqual([]);
  }, 30_000);

  it('silencio durante la creación (tras el proveedor, antes de insertar): 503 en menos de 10 s y no se crea nada', async () => {
    await ctx.publish(faq());
    const slow = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => slow.promise);
    const creating = run(
      ctx.conv.create({ flowId: 'faq-ia', contactId: 'qa6-mudo' }),
    );
    await ctx.testApp.llm.untilCalls(1);
    proxy.mode = 'freeze';
    slow.resolve(keepTalking());
    const started = performance.now();
    const res = await creating;
    expect([res.status, res.body]).toEqual([503, UNAVAILABLE]);
    expect(performance.now() - started).toBeLessThan(10_000);
    proxy.mode = 'pass';
    expect((await ctx.conv.list().expect(200)).body.total).toBe(0);
  }, 30_000);

  it('silencio en cualquier ruta de lectura y de borrado: 503 en menos de 10 s', async () => {
    await ctx.publish(hola());
    const { id } = await ctx.start('hola', { contactId: 'qa6-mudo2' });
    proxy.mode = 'freeze';
    const calls: [string, () => Test][] = [
      ['list', () => ctx.conv.list()],
      ['get', () => ctx.conv.get(id)],
      ['transcript', () => ctx.conv.transcript(id)],
      ['remove', () => ctx.conv.remove(id)],
      ['removeContact', () => ctx.conv.removeContact('qa6-mudo2')],
    ];
    const started = performance.now();
    const responses = await Promise.all(calls.map(([, call]) => run(call())));
    const elapsed = performance.now() - started;
    responses.forEach((res, index) =>
      expect([calls[index]![0], res.status, res.body]).toEqual([
        calls[index]![0],
        503,
        UNAVAILABLE,
      ]),
    );
    expect(elapsed).toBeLessThan(10_000);
    proxy.mode = 'pass';
    expect((await ctx.conv.get(id).expect(200)).body.revision).toBe(1);
  }, 30_000);

  it('corte de todas las conexiones (reset) entre peticiones y a mitad de un avance: la API sigue viva y se recupera', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking());
    const { id } = await ctx.start('faq-ia');
    // Con las conexiones del pool inactivas cortadas, la petición siguiente puede fallar una vez, pero nunca con un 500.
    proxy.reset();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const first = await ctx.conv.get(id);
    expect([200, 503], first.text).toContain(first.status);
    const second = await ctx.conv.get(id).expect(200);
    expect(second.body.revision).toBe(1);

    // A mitad de un avance: el proveedor responde después de cortar la base.
    const slow = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => slow.promise);
    const sending = run(ctx.conv.send(id, { input: { text: 'uno' } }));
    await ctx.testApp.llm.untilCalls(2);
    proxy.reset();
    await new Promise((resolve) => setTimeout(resolve, 100));
    slow.resolve(keepTalking());
    const res = await sending;
    expect([200, 503], res.text).toContain(res.status);
    if (res.status === 503) expect(res.body).toEqual(UNAVAILABLE);
    const after = (await ctx.conv.get(id)).body;
    expect(after.revision).toBe(res.status === 200 ? 2 : 1);
    expect(output.text()).not.toMatch(/unhandled|uncaught/i);
  }, 30_000);
});
