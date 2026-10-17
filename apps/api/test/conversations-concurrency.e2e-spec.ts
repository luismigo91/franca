import { randomUUID } from 'node:crypto';
import type { LlmTurnRequest, LlmTurnResult } from '@franca/engine';
import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Deferred, keepTalking } from './helpers/conversations-llm.js';
import { hookedRepositoryOf, withHookedRepository, type HookedConversationsRepository } from './helpers/conversations-repository.js';
import { dumpConversationTables, faq, hola, leads, pregunta, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

/** Lanza la petición ya y devuelve su respuesta como promesa (un `Test` de supertest solo se envía al esperarlo). */
function run(test: Test): Promise<Response> {
  return new Promise((resolve, reject) => void test.then(resolve, reject));
}

const lastUserText = (request: LlmTurnRequest): string | undefined => request.history[request.history.length - 1]?.text;

describe('concurrencia (e2e)', () => {
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

  /** Una conversación de `faq-ia` esperando en `asistente`: el turno de la creación lo resuelve el proveedor al instante. */
  async function faqWaiting(extra: Record<string, unknown> = {}) {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking());
    return ctx.start('faq-ia', extra);
  }

  it('Dos entradas simultáneas', async () => {
    const { id } = await faqWaiting();
    const gate = new Deferred<LlmTurnResult>();
    // El turno de la creación es el 0; los demás esperan a que lo indique el test.
    ctx.testApp.llm.use((_request, index) => (index === 0 ? keepTalking() : gate.promise));

    const first = run(ctx.conv.send(id, { input: { text: 'uno' } }));
    const second = run(ctx.conv.send(id, { input: { text: 'dos' } }));
    await ctx.testApp.llm.untilCalls(2);
    const busy = await Promise.race([first, second]);
    expect(busy.status).toBe(409);
    expect(busy.body).toEqual({ message: expect.any(String), error: 'conversation_busy' });

    // Mientras el proveedor no responde, la conversación está procesando.
    expect((await ctx.conv.get(id).expect(200)).body.processing).toBe(true);
    gate.resolve(keepTalking());
    const responses = await Promise.all([first, second]);
    expect(responses.map((res) => res.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(ctx.testApp.llm.requests).toHaveLength(2);
    const applied = responses.find((res) => res.status === 200)!;
    const winner = applied === responses[0] ? 'uno' : 'dos';
    const loser = winner === 'uno' ? 'dos' : 'uno';
    const after = (await ctx.conv.get(id).expect(200)).body;
    expect(after).toMatchObject({ processing: false, revision: 2 });

    ctx.testApp.llm.use(keepTalking());
    await ctx.say(id, { text: 'tres' });
    const history = ctx.testApp.llm.historyOf(2);
    expect(history).toContain(winner);
    expect(history).not.toContain(loser);
  });

  it('Un rechazo libera la reclamación', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    const rejected = await ctx.conv.send(id, { input: { choice: 'x' } }).expect(400);
    expect(rejected.body.error).toBe('invalid_input');
    expect((await ctx.conv.get(id).expect(200)).body.processing).toBe(false);
    await ctx.conv.send(id, { input: { text: 'Ana' } }).expect(200);
  });

  describe('reclamación caducada', () => {
    /** `faq-ia` esperando; el turno que pide la entrada `"uno"` no se resuelve hasta que el test lo indique. */
    async function hangingFirstInput() {
      const { id } = await faqWaiting();
      const late = new Deferred<LlmTurnResult>();
      ctx.testApp.llm.use((request) => (lastUserText(request) === 'uno' ? late.promise : keepTalking()));
      const first = run(ctx.conv.send(id, { input: { text: 'uno' } }));
      await ctx.testApp.llm.untilCalls(2);
      return { id, late, first };
    }

    it('Proveedor que no responde', async () => {
      const { id, late } = await hangingFirstInput();
      ctx.testApp.clock.advance(299_000);
      const busy = await ctx.conv.send(id, { input: { text: 'dos' } }).expect(409);
      expect(busy.body.error).toBe('conversation_busy');
      ctx.testApp.clock.advance(1000);
      await ctx.conv.send(id, { input: { text: 'tres' } }).expect(200);
      const request = ctx.testApp.llm.requests[ctx.testApp.llm.requests.length - 1]!;
      const texts = request.history.map((message) => message.text);
      expect(texts[texts.length - 1]).toBe('tres');
      expect(texts).not.toContain('uno');
      late.resolve(keepTalking());
    });

    it('Resultado que llega tarde', async () => {
      const { id, late, first } = await hangingFirstInput();
      ctx.testApp.clock.advance(300_000);
      await ctx.conv.send(id, { input: { text: 'tres' } }).expect(200);
      const before = (await ctx.conv.get(id).expect(200)).body;
      late.resolve(keepTalking(0.01));
      const stale = await first;
      expect(stale.status).toBe(409);
      expect(stale.body.error).toBe('conversation_busy');
      const transcript = await ctx.conv.transcript(id, '?limit=100').expect(200);
      expect(transcript.text).not.toContain('"uno"');
      const after = (await ctx.conv.get(id).expect(200)).body;
      expect(after).toMatchObject({ revision: before.revision, costUsd: before.costUsd, updatedAt: before.updatedAt });
      expect(after.costUsd).toBeCloseTo(0.02, 12);
    });
  });

  it('Borrar mientras se procesa una entrada', async () => {
    const { id } = await faqWaiting();
    const gate = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => gate.promise);
    const sending = run(ctx.conv.send(id, { input: { text: 'uno' } }));
    await ctx.testApp.llm.untilCalls(2);
    await ctx.conv.remove(id).expect(204);
    gate.resolve(keepTalking());
    const response = await sending;
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('conversation_not_found');
    const rows = await ctx.prisma.$queryRaw<{ conversations: bigint; entries: bigint }[]>`
      SELECT (SELECT count(*) FROM conversations WHERE id = ${id}::uuid) AS conversations,
             (SELECT count(*) FROM conversation_entries WHERE conversation_id = ${id}::uuid) AS entries`;
    expect(Number(rows[0]!.conversations)).toBe(0);
    expect(Number(rows[0]!.entries)).toBe(0);
  });

  it('Borrar un contacto mientras se crea una conversación suya', async () => {
    await ctx.publish(faq());
    await ctx.prisma.contact.create({
      data: { id: 'c-1', epoch: randomUUID(), values: { create: [{ name: 'email', valueJson: JSON.stringify('ana@example.com') }] } },
    });
    const gate = new Deferred<LlmTurnResult>();
    ctx.testApp.llm.use(() => gate.promise);
    const creating = run(ctx.conv.create({ flowId: 'faq-ia', contactId: 'c-1' }));
    await ctx.testApp.llm.untilCalls(1);
    await ctx.conv.removeContact('c-1').expect(204);
    gate.resolve({ kind: 'turn', text: 'Hola', slots: {}, done: false, costUsd: 0.01 });
    const response = await creating;
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('conversation_not_found');
    expect((await ctx.conv.list().expect(200)).body.total).toBe(0);
    expect(await dumpConversationTables(ctx.prisma)).not.toContain('ana@example.com');
  });

  describe('de implementación', () => {
    /** `captacion-leads` con contacto, esperando en `pedir-email`: el siguiente avance escribe valores de contacto. */
    async function leadsWithContact() {
      await ctx.publish(leads());
      const { id } = await ctx.start('captacion-leads', { contactId: 'c-1' });
      await ctx.say(id, { text: 'Ana' });
      return id;
    }

    it('borrar un contacto con el avance aplicándose: espera al bloqueo, el avance se aplica y el borrado lo borra', async () => {
      const id = await leadsWithContact();
      const locked = new Deferred();
      const release = new Deferred();
      repository.onLocked = async (step) => {
        if (step !== 'apply') return;
        locked.resolve();
        await release.promise;
      };
      const sending = run(ctx.conv.send(id, { input: { text: 'ana@example.com' } }));
      await locked.promise;
      const deleting = run(ctx.conv.removeContact('c-1'));
      // El borrado espera al bloqueo del contacto: ni termina ni da error mientras el avance sigue abierto.
      await new Promise((resolve) => setTimeout(resolve, 300));
      release.resolve();
      const [sent, deleted] = await Promise.all([sending, deleting]);
      expect(sent.status).toBe(200);
      expect(deleted.status).toBe(204);
      await ctx.conv.get(id).expect(404);
      expect(await dumpConversationTables(ctx.prisma)).not.toContain('ana@example.com');
    });

    it('el orden de bloqueos es contacto y después conversación: un borrado de contacto a medias no interbloquea con aplicar', async () => {
      // `DELETE /contacts` toma la fila del contacto y, por la cascada, las de sus conversaciones. Se emula en una
      // transacción propia para fijar el entrelazado que lo haría interbloquearse con un «aplicar» que bloqueara antes
      // la conversación: la emulada tiene el contacto y pide la conversación mientras «aplicar» ya espera su turno.
      const id = await leadsWithContact();
      const go = new Deferred();
      repository.beforeStep = async (step) => {
        if (step === 'apply') await go.promise;
      };
      const sending = run(ctx.conv.send(id, { input: { text: 'ana@example.com' } }));
      const deleterHasContact = new Deferred();
      const deleterMayAsk = new Deferred();
      const deleter = ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM contacts WHERE contact_id = 'c-1' FOR UPDATE`;
        deleterHasContact.resolve();
        await deleterMayAsk.promise;
        await tx.$queryRaw`SELECT 1 AS locked FROM conversations WHERE id = ${id}::uuid FOR UPDATE`;
      });
      await deleterHasContact.promise;
      go.resolve();
      // «Aplicar» llega a sus bloqueos mientras el borrado tiene el contacto.
      await new Promise((resolve) => setTimeout(resolve, 400));
      deleterMayAsk.resolve();
      const [sent] = await Promise.all([sending, deleter]);
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    });

    it('borrar un contacto mientras se aplica un avance, sin interbloqueo (40P01)', async () => {
      // Distintos desfases entre el borrado y el paso «aplicar»: el avance puede ganar (200) o perder (404), nunca fallar.
      for (let round = 0; round < 18; round += 1) {
        await ctx.reset();
        repository.clear();
        const id = await leadsWithContact();
        const go = new Deferred();
        repository.beforeStep = async (step) => {
          if (step === 'apply') await go.promise;
        };
        const sending = run(ctx.conv.send(id, { input: { text: 'ana@example.com' } }));
        const deleting = run(ctx.conv.removeContact('c-1'));
        await new Promise((resolve) => setTimeout(resolve, (round % 6) * 4));
        go.resolve();
        const [sent, deleted] = await Promise.all([sending, deleting]);
        expect(deleted.status, `ronda ${round}: borrado`).toBe(204);
        expect([200, 404], `ronda ${round}: avance (${sent.status} ${JSON.stringify(sent.body)})`).toContain(sent.status);
        await ctx.conv.get(id).expect(404);
      }
    });

    it('creación cuyo flujo se borra a mitad: 404 flow_not_found y nada creado', async () => {
      await ctx.publish(hola());
      repository.beforeInsert = async () => {
        await ctx.flows.remove('hola').expect(204);
      };
      const res = await ctx.conv.create({ flowId: 'hola' }).expect(404);
      expect(res.body.error).toBe('flow_not_found');
      expect((await ctx.conv.list().expect(200)).body.total).toBe(0);
    });
  });
});

describe('avance más largo que el plazo de recepción (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext({ requestTimeoutMs: 1000 });
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('un avance de 2 s reales con requestTimeoutMs de 1000 responde 200', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking());
    const { id } = await ctx.start('faq-ia');
    ctx.testApp.llm.use(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return keepTalking();
    });
    const started = performance.now();
    const res = await ctx.conv.send(id, { input: { text: 'uno' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(performance.now() - started).toBeGreaterThanOrEqual(1900);
    expect(res.body.conversation.revision).toBe(2);
  });
});
