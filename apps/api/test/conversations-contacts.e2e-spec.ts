import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dumpConversationTables,
  fijarProto,
  hola,
  leads,
  olvido,
  pregunta,
  saludoContacto,
  saludoProto,
  startConversationsContext,
  type ConversationsContext,
} from './helpers/conversations.js';

describe('contactos (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  /** Un contacto con valores guardados, escritos directamente en la base. */
  async function seedContact(contactId: string, values: Record<string, unknown>) {
    await ctx.prisma.contact.create({
      data: { id: contactId, epoch: randomUUID(), values: { create: Object.entries(values).map(([name, value]) => ({ name, valueJson: JSON.stringify(value) })) } },
    });
  }

  /** El texto del primer `message` de una conversación nueva de `saludo-contacto` (o `saludo-proto`). */
  async function greeting(flowId: string, contactId?: string, version?: number): Promise<string> {
    const created = await ctx.start(flowId, { ...(contactId === undefined ? {} : { contactId }), ...(version === undefined ? {} : { version }) });
    return created.body.events[0].content[0].text;
  }

  /** Una conversación de `captacion-leads` que guarda el email de `contactId`. */
  async function leadsSavingEmail(contactId: string) {
    const { id } = await ctx.start('captacion-leads', { contactId });
    await ctx.say(id, { text: 'Ana' });
    await ctx.say(id, { text: 'ana@example.com' });
    return id;
  }

  it('Identificadores de contacto', async () => {
    await ctx.publish(hola());
    for (const contactId of ['ana@example.com', '', 'c 1', 'a'.repeat(65)]) {
      const res = await ctx.conv.create({ flowId: 'hola', contactId }).expect(400);
      expect(res.body, JSON.stringify(contactId)).toEqual({ message: expect.any(String), error: 'invalid_request' });
    }
    for (const contactId of ['c-1', 'a'.repeat(64), '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90']) {
      const res = await ctx.conv.create({ flowId: 'hola', contactId }).expect(201);
      expect(res.body.conversation.contactId).toBe(contactId);
    }
  });

  it('El email pasa de un flujo a otro', async () => {
    await ctx.publish(leads());
    await ctx.publish(saludoContacto());
    await leadsSavingEmail('c-1');
    expect(await greeting('saludo-contacto', 'c-1')).toBe('Hola, ana@example.com.');
    expect(await greeting('saludo-contacto', 'c-2')).toBe('Hola, .');
    expect(await greeting('saludo-contacto')).toBe('Hola, .');
  });

  it('Vista fijada al crear', async () => {
    await ctx.publish(pregunta());
    await ctx.publish(olvido());
    await ctx.publish(saludoContacto());
    await seedContact('c-1', { email: 'ana@example.com' });
    const waiting = await ctx.start('pregunta', { contactId: 'c-1' });
    await ctx.start('olvido', { contactId: 'c-1' });
    const sent = await ctx.say(waiting.id, { text: 'Ana' });
    expect(sent.events[0].content[0].text).toBe('Adiós, ana@example.com.');
    // La conversación de pregunta no volvió a escribir el email que no cambió.
    expect(await greeting('saludo-contacto', 'c-1')).toBe('Hola, .');
  });

  it('Un default no se guarda', async () => {
    await ctx.publish(saludoContacto());
    const withDefault = saludoContacto();
    withDefault.variables[0].default = 'nadie@example.com';
    await ctx.republish(withDefault);
    expect(await greeting('saludo-contacto', 'c-5', 2)).toBe('Hola, nadie@example.com.');
    expect(await greeting('saludo-contacto', 'c-5', 1)).toBe('Hola, .');
    const stored = await ctx.prisma.contactValue.count({ where: { contactId: 'c-5' } });
    expect(stored).toBe(0);
  });

  it('Borrar un valor con set', async () => {
    await ctx.publish(olvido());
    await ctx.publish(saludoContacto());
    await seedContact('c-1', { email: 'ana@example.com' });
    await ctx.start('olvido', { contactId: 'c-1' });
    expect(await greeting('saludo-contacto', 'c-1')).toBe('Hola, .');
    expect(await ctx.prisma.contactValue.count({ where: { contactId: 'c-1' } })).toBe(0);
  });

  it('Variable de contacto llamada __proto__', async () => {
    await ctx.publish(saludoProto());
    await ctx.publish(fijarProto());
    await ctx.start('fijar-proto', { contactId: 'c-6' });
    expect(await greeting('saludo-proto', 'c-6')).toBe('Hola, x@example.com.');
    const stored = await ctx.prisma.contactValue.findMany({ where: { contactId: 'c-6' } });
    expect(stored.map((row) => [row.name, row.valueJson])).toEqual([['__proto__', '"x@example.com"']]);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('solo se guarda lo que el avance cambió', async () => {
    await ctx.publish(leads());
    const { id } = await ctx.start('captacion-leads', { contactId: 'c-1' });
    await ctx.say(id, { text: 'Ana' });
    // `nombre` es de sesión y `email` aún no tiene valor: no hay nada que guardar.
    expect(await ctx.prisma.contactValue.count({ where: { contactId: 'c-1' } })).toBe(0);
    await ctx.say(id, { text: 'ana@example.com' });
    const stored = await ctx.prisma.contactValue.findMany({ where: { contactId: 'c-1' } });
    expect(stored.map((row) => [row.name, row.valueJson])).toEqual([['email', '"ana@example.com"']]);
  });

  it('Borrar y volver a leer', async () => {
    await ctx.publish(leads());
    await ctx.publish(saludoContacto());
    const id = await leadsSavingEmail('c-1');
    await ctx.conv.remove(id).expect(204);
    for (const res of [await ctx.conv.get(id), await ctx.conv.transcript(id), await ctx.conv.remove(id)]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: expect.any(String), error: 'conversation_not_found' });
    }
    // No borra los valores guardados de su contacto.
    expect(await greeting('saludo-contacto', 'c-1')).toBe('Hola, ana@example.com.');
  });

  it('Supresión de un contacto', async () => {
    await ctx.publish(leads());
    await ctx.publish(pregunta());
    await ctx.publish(saludoContacto());
    const first = await leadsSavingEmail('c-1');
    const second = (await ctx.start('pregunta', { contactId: 'c-1' })).id;
    const other = (await ctx.start('pregunta', { contactId: 'c-2' })).id;
    expect(await dumpConversationTables(ctx.prisma)).toContain('ana@example.com');

    await ctx.conv.removeContact('c-1').expect(204);
    await ctx.conv.get(first).expect(404);
    await ctx.conv.get(second).expect(404);
    await ctx.conv.get(other).expect(200);
    expect((await ctx.conv.list().expect(200)).body.total).toBe(1);
    expect(await greeting('saludo-contacto', 'c-1')).toBe('Hola, .');
    expect(await dumpConversationTables(ctx.prisma)).not.toContain('ana@example.com');
  });

  it('Contacto sin datos o mal escrito', async () => {
    await ctx.conv.removeContact('nadie').expect(204);
    const res = await ctx.conv.removeContact('ana@example.com').expect(400);
    expect(res.body).toEqual({ message: expect.any(String), error: 'invalid_request' });
  });
});
