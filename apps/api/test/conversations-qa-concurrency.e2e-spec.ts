import type { LlmTurnResult } from '@franca/engine';
import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Deferred, keepTalking } from './helpers/conversations-llm.js';
import {
  hookedRepositoryOf,
  withHookedRepository,
  type HookedConversationsRepository,
} from './helpers/conversations-repository.js';
import {
  faq,
  hola,
  pregunta,
  saludoContacto,
  startConversationsContext,
  type ConversationsContext,
} from './helpers/conversations.js';
import { captureOutput } from './helpers/output.js';

/** Lanza la petición ya y devuelve su respuesta como promesa. */
function run(test: Test): Promise<Response> {
  return new Promise((resolve, reject) => void test.then(resolve, reject));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('QA: concurrencia y reclamación (e2e)', () => {
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

  /** Entradas de usuario aplicadas, tal como las deja la transcripción. */
  async function userInputs(id: string): Promise<string[]> {
    const items = (await ctx.conv.transcript(id, '?limit=100').expect(200)).body
      .items as any[];
    expect(items.map((item) => item.seq)).toEqual(
      items.map((_, index) => index + 1),
    );
    return items
      .filter((item) => item.role === 'user')
      .map((item) => item.input.text);
  }

  it('12 entradas a la vez, con y sin If-Match: nunca 5xx, y la revisión y la transcripción cuentan exactamente las aplicadas', async () => {
    for (const mode of [
      'sin If-Match',
      'If-Match "1"',
      'If-Match *',
      'mezcladas',
    ]) {
      await ctx.reset();
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      const matchFor = (index: number) =>
        mode === 'sin If-Match'
          ? undefined
          : mode === 'If-Match "1"'
            ? '"1"'
            : mode === 'If-Match *'
              ? '*'
              : index % 2 === 0
                ? '"1"'
                : undefined;
      // El texto en blanco es un reintento: la conversación sigue esperando y admite otra entrada.
      const sent = Array.from({ length: 12 }, (_, index) =>
        run(
          ctx.conv.send(
            id,
            { input: { text: `${' '.repeat(index + 1)}` } },
            matchFor(index),
          ),
        ),
      );
      const responses = await Promise.all(sent);
      const statuses = responses.map((res) => res.status);
      expect(
        statuses.filter((status) => status >= 500),
        `${mode}: ${JSON.stringify(responses.map((res) => res.body))}`,
      ).toEqual([]);
      for (const res of responses) {
        expect([200, 409, 412], `${mode}: ${res.text}`).toContain(res.status);
        if (res.status === 409)
          expect(res.body.error).toBe('conversation_busy');
        if (res.status === 412)
          expect(res.body.error).toBe('revision_mismatch');
      }
      const applied = statuses.filter((status) => status === 200).length;
      expect(applied, mode).toBeGreaterThanOrEqual(1);
      if (mode === 'If-Match "1"') expect(applied).toBe(1);
      const after = (await ctx.conv.get(id).expect(200)).body;
      expect(after, mode).toMatchObject({
        revision: 1 + applied,
        processing: false,
        status: 'waiting',
      });
      expect(await userInputs(id), mode).toHaveLength(applied);
      // Las revisiones de las respuestas 200 son todas distintas: nadie aplicó sobre una revisión vieja.
      const revisions = responses
        .filter((res) => res.status === 200)
        .map((res) => res.body.conversation.revision);
      expect(new Set(revisions).size).toBe(applied);
    }
  });

  it('tormenta de creaciones, entradas, borrados y listados del mismo contacto: ningún 5xx ni interbloqueo en el registro', async () => {
    const output = captureOutput();
    await ctx.publish(pregunta());
    await ctx.publish(saludoContacto());
    await ctx.publish(hola());
    for (let round = 0; round < 6; round += 1) {
      const contactId = `qa6-storm-${round}`;
      const seeds = await Promise.all(
        Array.from({ length: 3 }, () => ctx.start('pregunta', { contactId })),
      );
      const ids = seeds.map((seed) => seed.id);
      const calls: Promise<Response>[] = [];
      for (const id of ids) {
        calls.push(
          run(ctx.conv.send(id, { input: { text: 'Ana' } })),
          run(ctx.conv.send(id, { input: { text: 'Bea' } })),
          run(ctx.conv.get(id)),
          run(ctx.conv.transcript(id)),
        );
      }
      calls.push(
        run(ctx.conv.create({ flowId: 'saludo-contacto', contactId })),
        run(ctx.conv.create({ flowId: 'pregunta', contactId })),
        run(ctx.conv.list('?limit=5')),
      );
      calls.push(
        run(ctx.conv.remove(ids[0]!)),
        run(ctx.conv.removeContact(contactId)),
        run(ctx.conv.removeContact(contactId)),
      );
      const responses = await Promise.all(
        calls.map((call, index) => sleep((index % 5) * 3).then(() => call)),
      );
      for (const res of responses)
        expect(
          res.status,
          `ronda ${round}: ${res.status} ${res.text}`,
        ).toBeLessThan(500);
    }
    expect(output.text()).not.toMatch(/40P01|deadlock|40001|serialization/i);
    expect(output.lines().filter((line) => line.startsWith('error'))).toEqual(
      [],
    );
    expect(
      (await ctx.conv.list().expect(200)).body.total,
    ).toBeGreaterThanOrEqual(0);
  });

  it('veinte creaciones simultáneas de contactos nuevos y repetidos: todas 201 y una sola fila por contacto', async () => {
    await ctx.publish(hola());
    await ctx.publish(saludoContacto());
    const ids = ['qa6-a', 'qa6-b', 'qa6-c', 'qa6-d', 'qa6-e'];
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        run(
          ctx.conv.create({
            flowId: index % 2 === 0 ? 'hola' : 'saludo-contacto',
            contactId: ids[index % ids.length],
          }),
        ),
      ),
    );
    expect(responses.map((res) => res.status)).toEqual(Array(20).fill(201));
    const rows = await ctx.prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM contacts`;
    expect(Number(rows[0]!.n)).toBe(5);
  });

  it('contacto borrado y recreado durante la creación: la creación vieja no se cuela en el contacto nuevo (epoch)', async () => {
    await ctx.publish(faq());
    await ctx.publish(hola());
    const gate = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => gate.promise);
    const creating = run(
      ctx.conv.create({ flowId: 'faq-ia', contactId: 'qa6-epoch' }),
    );
    await ctx.testApp.llm.untilCalls(1);
    await ctx.conv.removeContact('qa6-epoch').expect(204);
    // Otra conversación recrea el contacto con el mismo identificador mientras la primera sigue en el proveedor.
    const recreated = (
      await ctx.conv
        .create({ flowId: 'hola', contactId: 'qa6-epoch' })
        .expect(201)
    ).body.conversation.id as string;
    gate.resolve(keepTalking());
    const response = await creating;
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('conversation_not_found');
    const list = (await ctx.conv.list().expect(200)).body;
    expect(list.items.map((item: any) => item.id)).toEqual([recreated]);
  });

  it('un avance cuyo contacto se borra y recrea mientras el proveedor responde se descarta (404) y no escribe en el contacto nuevo', async () => {
    await ctx.publish(faq());
    await ctx.publish(saludoContacto());
    ctx.testApp.llm.use(keepTalking());
    const { id } = await ctx.start('faq-ia', { contactId: 'qa6-epoch2' });
    const gate = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => gate.promise);
    const sending = run(ctx.conv.send(id, { input: { text: 'uno' } }));
    await ctx.testApp.llm.untilCalls(2);
    await ctx.conv.removeContact('qa6-epoch2').expect(204);
    await ctx.conv
      .create({ flowId: 'saludo-contacto', contactId: 'qa6-epoch2' })
      .expect(201);
    gate.resolve(keepTalking());
    const response = await sending;
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('conversation_not_found');
    expect((await ctx.conv.list().expect(200)).body.total).toBe(1);
  });

  it('el resultado tardío de una entrada a una conversación borrada y recreada con el mismo contacto no toca la nueva', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking());
    const { id } = await ctx.start('faq-ia', { contactId: 'qa6-epoch3' });
    const gate = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => gate.promise);
    const sending = run(ctx.conv.send(id, { input: { text: 'viejo' } }));
    await ctx.testApp.llm.untilCalls(2);
    await ctx.conv.remove(id).expect(204);
    ctx.testApp.llm.use(keepTalking());
    const fresh = await ctx.start('faq-ia', { contactId: 'qa6-epoch3' });
    gate.resolve(keepTalking());
    expect((await sending).status).toBe(404);
    expect(await userInputs(fresh.id)).toEqual([]);
    expect((await ctx.conv.get(fresh.id).expect(200)).body.revision).toBe(1);
  });

  it('API que muere entre reclamar y aplicar: la reclamación sobrevive 300 s, después se repite y el estado no cambió', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    // Se emula la muerte del proceso: el paso de aplicar falla de forma que no libera nada (la liberación es del camino de error del motor).
    repository.failNextApply = true;
    const died = await ctx.conv.send(id, { input: { text: 'Ana' } });
    expect(died.status).toBe(503);
    const stuck = (await ctx.conv.get(id).expect(200)).body;
    expect(stuck).toMatchObject({
      revision: 1,
      status: 'waiting',
      processing: true,
    });
    expect((await ctx.conv.send(id, { input: { text: 'Ana' } })).status).toBe(
      409,
    );
    ctx.testApp.clock.advance(299_000);
    expect(
      (await ctx.conv.send(id, { input: { text: 'Ana' } })).body.error,
    ).toBe('conversation_busy');
    ctx.testApp.clock.advance(1_000);
    const retried = await ctx.conv
      .send(id, { input: { text: 'Ana' } })
      .expect(200);
    expect(retried.body.conversation).toMatchObject({
      revision: 2,
      status: 'ended',
      processing: false,
    });
    expect(await userInputs(id)).toEqual(['Ana']);
  });

  it('una conversación con la reclamación vencida sigue mostrando processing false y se puede borrar con un avance colgado', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking());
    const { id } = await ctx.start('faq-ia');
    const gate = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => gate.promise);
    const hanging = run(ctx.conv.send(id, { input: { text: 'uno' } }));
    await ctx.testApp.llm.untilCalls(2);
    ctx.testApp.clock.advance(300_000);
    expect((await ctx.conv.get(id).expect(200)).body.processing).toBe(false);
    const list = (await ctx.conv.list().expect(200)).body.items as any[];
    expect(list[0].processing).toBe(false);
    await ctx.conv.remove(id).expect(204);
    gate.resolve(keepTalking());
    expect((await hanging).status).toBe(404);
  });

  it('un 412 no libera ni toma la reclamación de otra entrada en curso', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking());
    const { id } = await ctx.start('faq-ia');
    const gate = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => gate.promise);
    const winner = run(ctx.conv.send(id, { input: { text: 'uno' } }, '"1"'));
    await ctx.testApp.llm.untilCalls(2);
    const stale = await ctx.conv.send(id, { input: { text: 'dos' } }, '"7"');
    expect(stale.status).toBe(412);
    expect(stale.body.currentRevision).toBe(1);
    expect((await ctx.conv.get(id).expect(200)).body.processing).toBe(true);
    gate.resolve(keepTalking());
    expect((await winner).status).toBe(200);
  });

  it('If-Match sobre una conversación en curso con revisión válida es 409 busy, no 412', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking());
    const { id } = await ctx.start('faq-ia');
    const gate = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => gate.promise);
    const first = run(ctx.conv.send(id, { input: { text: 'uno' } }));
    await ctx.testApp.llm.untilCalls(2);
    const second = await ctx.conv.send(id, { input: { text: 'dos' } }, '"1"');
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('conversation_busy');
    gate.resolve(keepTalking());
    await first;
  });

  it('carga: 60 conversaciones reciben una entrada a la vez junto con 120 lecturas y 30 creaciones, sin 5xx (el pool de 10 no se agota)', async () => {
    await ctx.publish(pregunta());
    const seeds = [] as string[];
    for (let index = 0; index < 60; index += 1)
      seeds.push(
        (await ctx.start('pregunta', { contactId: `qa6-load-${index % 12}` }))
          .id,
      );
    const calls: Promise<Response>[] = [];
    for (const id of seeds)
      calls.push(
        run(ctx.conv.send(id, { input: { text: 'Ana' } })),
        run(ctx.conv.get(id)),
        run(ctx.conv.transcript(id)),
      );
    for (let index = 0; index < 30; index += 1)
      calls.push(
        run(
          ctx.conv.create({
            flowId: 'pregunta',
            contactId: `qa6-load-${index % 12}`,
          }),
        ),
      );
    const responses = await Promise.all(calls);
    const failures = responses.filter(
      (res) => res.status >= 400 && !(res.status === 201 || res.status === 200),
    );
    expect(failures.map((res) => `${res.status} ${res.text}`)).toEqual([]);
    expect((await ctx.conv.list('?status=ended').expect(200)).body.total).toBe(
      60,
    );
  }, 60_000);
});
