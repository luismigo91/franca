import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leads, pregunta, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

const MINUTE = 60_000;

describe('caducidad por inactividad (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const at = (iso: string, offsetMs: number) => new Date(Date.parse(iso) + offsetMs);

  it('Entrada después del plazo', async () => {
    await ctx.publish(pregunta());
    const created = await ctx.start('pregunta');
    const { createdAt, expiresAt } = created.body.conversation;
    expect(Date.parse(expiresAt) - Date.parse(createdAt)).toBe(30 * MINUTE);

    // T + 29 min 59 s: sigue esperando.
    ctx.testApp.clock.set(at(createdAt, 30 * MINUTE - 1000));
    const early = (await ctx.conv.get(created.id).expect(200)).body;
    expect(early).toMatchObject({ status: 'waiting', expiresAt });

    // T + 30 min: la entrada no se admite y no cambia nada.
    ctx.testApp.clock.set(new Date(expiresAt));
    const late = await ctx.conv.send(created.id, { input: { text: 'Ana' } }).expect(409);
    expect(late.body).toEqual({ message: expect.any(String), error: 'conversation_expired' });

    ctx.testApp.clock.set(new Date(expiresAt));
    const expired = (await ctx.conv.get(created.id).expect(200)).body;
    expect(expired).toMatchObject({ status: 'expired', pendingInput: null, expiresAt, revision: 1, updatedAt: createdAt });
    expect((await ctx.conv.transcript(created.id).expect(200)).body.total).toBe(created.body.events.length);
  });

  it('Un avance renueva el plazo', async () => {
    await ctx.publish(pregunta());
    const created = await ctx.start('pregunta');
    const { createdAt } = created.body.conversation;

    ctx.testApp.clock.set(at(createdAt, 20 * MINUTE));
    const retry = (await ctx.conv.send(created.id, { input: { text: '   ' } }).expect(200)).body.conversation;
    expect(Date.parse(retry.updatedAt)).toBeGreaterThanOrEqual(Date.parse(createdAt) + 20 * MINUTE);
    expect(Date.parse(retry.updatedAt)).toBeLessThan(Date.parse(createdAt) + 20 * MINUTE + 1000);
    // El plazo cuenta desde el avance aplicado: T + 20 min + 30 min.
    expect(Date.parse(retry.expiresAt) - Date.parse(retry.updatedAt)).toBe(30 * MINUTE);

    ctx.testApp.clock.set(at(createdAt, 45 * MINUTE));
    const done = (await ctx.conv.send(created.id, { input: { text: 'Ana' } }).expect(200)).body.conversation;
    expect(done.status).toBe('ended');
  });

  it('Plazo por defecto y plazo enorme', async () => {
    await ctx.publish(leads());
    const enormous = pregunta();
    enormous.settings.sessionTimeoutMinutes = 1e300;
    await ctx.publish(enormous);
    const byDefault = (await ctx.conv.create({ flowId: 'captacion-leads' }).expect(201)).body.conversation;
    const capped = (await ctx.conv.create({ flowId: 'pregunta' }).expect(201)).body.conversation;
    expect(Date.parse(byDefault.expiresAt) - Date.parse(byDefault.createdAt)).toBe(1440 * MINUTE);
    expect(Date.parse(capped.expiresAt) - Date.parse(capped.createdAt)).toBe(525_600 * MINUTE);
  });

  it('el listado deriva waiting y expired del reloj y una caducada se puede borrar', async () => {
    await ctx.publish(pregunta());
    const created = await ctx.start('pregunta');
    expect((await ctx.conv.list('?status=waiting').expect(200)).body.total).toBe(1);
    expect((await ctx.conv.list('?status=expired').expect(200)).body.total).toBe(0);

    ctx.testApp.clock.set(new Date(created.body.conversation.expiresAt));
    expect((await ctx.conv.list('?status=waiting').expect(200)).body.total).toBe(0);
    ctx.testApp.clock.set(new Date(created.body.conversation.expiresAt));
    const expired = (await ctx.conv.list('?status=expired').expect(200)).body;
    expect(expired.total).toBe(1);
    expect(expired.items[0]).toMatchObject({ id: created.id, status: 'expired' });
    await ctx.conv.remove(created.id).expect(204);
  });
});
