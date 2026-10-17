import { describe, expect, it } from 'vitest';
import { finishing } from './helpers/conversations-llm.js';
import { dumpConversationTables, faq, leads, startConversationsContext } from './helpers/conversations.js';
import { ResettableOutput } from './helpers/conversations-harness.js';

describe('privacidad de las conversaciones (e2e)', () => {
  it('Datos personales fuera del registro', async () => {
    const output = new ResettableOutput();
    output.install();
    const ctx = await startConversationsContext({ logger: output.logger });
    try {
      await ctx.reset();
      await ctx.publish(leads());
      await ctx.publish(faq());
      const lead = await ctx.start('captacion-leads', { contactId: 'c-1' });
      await ctx.say(lead.id, { text: 'Ana Pérez' });
      await ctx.say(lead.id, { text: 'ana@example.com' });
      ctx.testApp.llm.use(finishing(0.01, 'MARCA-RESPUESTA'));
      const asked = await ctx.start('faq-ia');
      await ctx.say(asked.id, { text: 'MARCA-PREGUNTA' });

      await ctx.conv.transcript(lead.id).expect(200);
      await ctx.conv.transcript(asked.id).expect(200);
      await ctx.conv.remove(lead.id).expect(204);
      await ctx.conv.remove(asked.id).expect(204);

      // La captura funciona (vio el arranque) y no hay nada de lo escrito.
      expect(output.text()).toContain('proveedor llm principal');
      for (const forbidden of ['Ana Pérez', 'ana@example.com', 'Encantado', 'MARCA-RESPUESTA', 'MARCA-PREGUNTA']) {
        expect(output.text(), forbidden).not.toContain(forbidden);
      }
    } finally {
      await ctx.reset();
      await ctx.close();
      output.uninstall();
    }
  });

  it('un error 5xx tampoco registra lo escrito', async () => {
    const output = new ResettableOutput();
    output.install();
    const ctx = await startConversationsContext({ logger: output.logger });
    try {
      await ctx.reset();
      await ctx.publish(leads());
      const { id } = await ctx.start('captacion-leads', { contactId: 'c-1' });
      // Un estado guardado con datos personales que el motor rechaza (es de otro flujo): ni el estado ni la entrada se registran.
      const state = JSON.stringify({ stateVersion: 1, flowId: 'otro', status: 'waiting', nodeId: 'pedir-nombre', variables: { nombre: 'MARCA-ESTADO' }, contact: { email: 'MARCA-ESTADO@example.com' }, outcome: null, error: null, attempt: 1 });
      await ctx.prisma.$executeRaw`UPDATE conversations SET state = ${state} WHERE id = ${id}::uuid`;
      await ctx.conv.send(id, { input: { text: 'Ana Pérez MARCA-5XX' } }).expect(500);
      expect(output.text()).toContain('500');
      expect(output.text()).toContain('state_mismatch');
      for (const forbidden of ['MARCA-5XX', 'Ana Pérez', 'MARCA-ESTADO', 'stateVersion']) expect(output.text(), forbidden).not.toContain(forbidden);
    } finally {
      await ctx.reset();
      await ctx.close();
      output.uninstall();
    }
  });

  it('Sin estado tras terminar', async () => {
    const ctx = await startConversationsContext();
    try {
      await ctx.reset();
      await ctx.publish(leads());
      const { id } = await ctx.start('captacion-leads', { contactId: 'c-1' });
      await ctx.say(id, { text: 'Ana' });
      // Mientras espera, el estado sí está guardado (el control del test).
      expect(await dumpConversationTables(ctx.prisma)).toContain('stateVersion');
      await ctx.say(id, { text: 'ana@example.com' });
      const finished = await ctx.say(id, { choice: 'grande' });
      expect(finished.conversation.status).toBe('failed');
      const rows = await ctx.prisma.$queryRaw<{ state: string | null; pending_input_json: string | null }[]>`SELECT state, pending_input_json FROM conversations WHERE id = ${id}::uuid`;
      expect(rows[0]).toEqual({ state: null, pending_input_json: null });
      expect(await dumpConversationTables(ctx.prisma)).not.toContain('stateVersion');
    } finally {
      await ctx.reset();
      await ctx.close();
    }
  });
});
