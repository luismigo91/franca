import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createConversationsTestApp, type ConversationsTestApp } from './helpers/conversations-app.js';
import { hookedRepositoryOf, withHookedRepository, type HookedConversationsRepository } from './helpers/conversations-repository.js';
import { conversationsClient, pregunta, saludoContacto, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';
import { createTestPrisma } from './helpers/database.js';
import { closedPort, SECRET_PASSWORD, urlTo } from './helpers/network.js';
import { captureOutput } from './helpers/output.js';

const UNAVAILABLE = { message: expect.any(String), error: 'database_unavailable' };

describe('base de datos de las conversaciones (e2e)', () => {
  describe('Postgres parado', () => {
    let testApp: ConversationsTestApp | undefined;
    afterEach(async () => {
      await testApp?.close();
      testApp = undefined;
    });

    it('Postgres parado en las conversaciones', async () => {
      const output = captureOutput();
      const port = await closedPort();
      testApp = await createConversationsTestApp({ logger: output.logger, config: { databaseUrl: urlTo(port) } });
      const conv = conversationsClient(testApp.server);
      const requests = [
        () => conv.create({ flowId: 'hola' }),
        () => conv.list(),
        () => conv.send('00000000-0000-4000-8000-000000000000', { input: { text: 'x' } }),
        () => conv.removeContact('c-1'),
      ];
      for (const send of requests) {
        const started = performance.now();
        const res = await send();
        expect(res.status).toBe(503);
        expect(res.body).toEqual(UNAVAILABLE);
        expect(performance.now() - started).toBeLessThan(10_000);
        expect(res.text).not.toContain(SECRET_PASSWORD);
      }
      expect(output.text()).not.toContain(SECRET_PASSWORD);
      expect(output.text()).not.toContain(`${port}`);
    });
  });

  describe('con la base de datos', () => {
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

    it('Fallo al guardar un avance', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      repository.failNextApply = true;
      const failed = await ctx.conv.send(id, { input: { text: 'Ana' } }).expect(503);
      expect(failed.body).toEqual(UNAVAILABLE);
      expect((await ctx.conv.get(id).expect(200)).body).toMatchObject({ revision: 1, status: 'waiting' });
      // La base ya responde, pero la reclamación sigue viva (no se sabe si el COMMIT llegó): hasta que caduque, ocupada.
      const busy = await ctx.conv.send(id, { input: { text: 'Ana' } }).expect(409);
      expect(busy.body.error).toBe('conversation_busy');
      ctx.testApp.clock.advance(300_000);
      const retry = await ctx.conv.send(id, { input: { text: 'Ana' } }).expect(200);
      expect(retry.body.conversation.status).toBe('ended');
    });

    it('el aplicar que falla no deja nada escrito', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      repository.failNextApply = true;
      await ctx.conv.send(id, { input: { text: 'Ana' } }).expect(503);
      const total = (await ctx.conv.transcript(id).expect(200)).body.total;
      expect(total).toBe(2);
    });

    describe('Estado guardado que el motor rechaza', () => {
      async function withOutput() {
        const output = captureOutput();
        const local = await startConversationsContext({ logger: output.logger });
        return { output, local };
      }

      it('Estado alterado en la base de datos', async () => {
        const { output, local } = await withOutput();
        try {
          await local.publish(pregunta());
          const { id } = await local.start('pregunta');
          await local.prisma.$executeRaw`UPDATE conversations SET state = '{}' WHERE id = ${id}::uuid`;
          const res = await local.conv.send(id, { input: { text: 'Ana' } }).expect(500);
          expect(res.body).toEqual({ message: 'error interno', error: 'internal_error' });
          const after = (await local.conv.get(id).expect(200)).body;
          expect(after).toMatchObject({ revision: 1, status: 'waiting', processing: false });
          expect(output.text()).toContain('invalid_state');
          expect(output.text()).toContain(id);
        } finally {
          await local.reset();
          await local.close();
        }
      });

      it.each([
        ['un estado que no es JSON', () => "'esto no es json'", 'invalid_state'],
        ['otro flujo', (state: string) => `'${state.replace('"flowId":"pregunta"', '"flowId":"otro"')}'`, 'state_mismatch'],
        ['una sesión que ya terminó', () => `'{"stateVersion":1,"flowId":"pregunta","status":"ended","nodeId":"fin","variables":{},"contact":{},"outcome":null,"error":null}'`, 'session_not_active'],
      ])('estado guardado con %s: 500 y el código en el registro', async (_name, rewrite, code) => {
        const { output, local } = await withOutput();
        try {
          await local.publish(pregunta());
          const { id } = await local.start('pregunta');
          const rows = await local.prisma.$queryRaw<{ state: string }[]>`SELECT state FROM conversations WHERE id = ${id}::uuid`;
          await local.prisma.$executeRawUnsafe(`UPDATE conversations SET state = ${rewrite(rows[0]!.state)} WHERE id = '${id}'::uuid`);
          const res = await local.conv.send(id, { input: { text: 'Ana' } }).expect(500);
          expect(res.body).toEqual({ message: 'error interno', error: 'internal_error' });
          expect(output.text()).toContain(code);
          expect((await local.conv.get(id).expect(200)).body).toMatchObject({ revision: 1, processing: false });
        } finally {
          await local.reset();
          await local.close();
        }
      });

      it('Valor de contacto alterado en la base de datos', async () => {
        const { output, local } = await withOutput();
        try {
          await local.publish(saludoContacto());
          const deep = `${'['.repeat(1000)}${']'.repeat(1000)}`;
          await local.prisma.contact.create({ data: { id: 'c-1', epoch: randomUUID(), values: { create: [{ name: 'email', valueJson: deep }] } } });
          const res = await local.conv.create({ flowId: 'saludo-contacto', contactId: 'c-1' }).expect(500);
          expect(res.body).toEqual({ message: 'error interno', error: 'internal_error' });
          expect((await local.conv.list().expect(200)).body.total).toBe(0);
          expect(output.text()).toContain('invalid_contact');
        } finally {
          await local.reset();
          await local.close();
        }
      });
    });
  });

  describe('columnas', () => {
    let prisma: PrismaClient;
    let columns: { table_name: string; column_name: string; data_type: string; collation_name: string | null }[];

    beforeAll(async () => {
      prisma = createTestPrisma();
      columns = await prisma.$queryRaw`SELECT table_name, column_name, data_type, collation_name FROM information_schema.columns WHERE table_schema = 'public'`;
    });
    afterAll(() => prisma.$disconnect());

    const column = (table: string, name: string) => columns.find((c) => c.table_name === table && c.column_name === name);

    it('el estado, las entradas, los eventos y los valores de contacto son text, no jsonb', () => {
      expect(column('conversations', 'state')?.data_type).toBe('text');
      expect(column('conversations', 'pending_input_json')?.data_type).toBe('text');
      expect(column('conversation_entries', 'payload')?.data_type).toBe('text');
      expect(column('contact_values', 'value_json')?.data_type).toBe('text');
      expect(columns.some((c) => c.data_type === 'jsonb' || c.data_type === 'json')).toBe(false);
    });

    it('flow_id, contact_id y name usan la colación C (Prisma no la modela)', () => {
      for (const [table, name] of [
        ['conversations', 'flow_id'],
        ['conversations', 'contact_id'],
        ['contacts', 'contact_id'],
        ['contact_values', 'contact_id'],
        ['contact_values', 'name'],
      ] as const) {
        expect(column(table, name)?.collation_name, `${table}.${name}`).toBe('C');
      }
    });

    it('las conversaciones no tienen clave foránea hacia flows ni flow_versions', async () => {
      const references = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM information_schema.constraint_column_usage u
        JOIN information_schema.table_constraints c ON c.constraint_name = u.constraint_name
        WHERE c.constraint_type = 'FOREIGN KEY' AND c.table_name = 'conversations' AND u.table_name IN ('flows', 'flow_versions')`;
      expect(Number(references[0]!.n)).toBe(0);
    });
  });
});
