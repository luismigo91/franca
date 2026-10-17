import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { finishing, keepTalking } from './helpers/conversations-llm.js';
import { captureOutput } from './helpers/output.js';
import { dobleLlm, faq, pregunta, startConversationsContext, type ConversationsContext } from './helpers/conversations.js';
import { llmHttp } from './helpers/http-flows.js';
import { P, startWorld } from './helpers/http-world.js';

describe('nodos llm de las conversaciones (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('Segundo llm fuera de plazo', async () => {
    await ctx.publish(dobleLlm());
    ctx.testApp.llm.use(() => {
      ctx.testApp.clock.advance(91_000);
      return finishing(0.01, 'Hola');
    });
    const res = await ctx.conv.create({ flowId: 'doble-llm' }).expect(201);
    expect(ctx.testApp.llm.requests).toHaveLength(1);
    expect(res.body.events).toEqual([
      { type: 'message', nodeId: 'a', content: [{ kind: 'text', text: 'Hola' }], typingDelayMs: 600 },
      { type: 'llm', nodeId: 'a', turns: 1, costUsd: 0.01, reason: null },
      { type: 'llm', nodeId: 'b', turns: 1, costUsd: 0, reason: 'provider_error' },
      { type: 'end', nodeId: 'fin', outcome: 'fin' },
    ]);
  });

  it('Llamada http fuera de plazo', async () => {
    await ctx.publish(llmHttp());
    ctx.testApp.llm.use(() => {
      ctx.testApp.clock.advance(91_000);
      return finishing(0.01, 'Hola');
    });
    const res = await ctx.conv.create({ flowId: 'llm-http' }).expect(201);
    expect(res.body.events).toEqual([
      { type: 'message', nodeId: 'a', content: [{ kind: 'text', text: 'Hola' }], typingDelayMs: 600 },
      { type: 'llm', nodeId: 'a', turns: 1, costUsd: 0.01, reason: null },
      { type: 'http', nodeId: 'h', attempts: 1, status: null, error: 'timeout' },
      { type: 'end', nodeId: 'ko', outcome: 'ko' },
    ]);
    expect(ctx.testApp.network.resolved()).not.toContain('api.example.com');
    expect(ctx.testApp.network.connections()).toEqual([]);
  });

  it('Intento http recortado por el plazo', async () => {
    const world = await startWorld();
    try {
      world.network.resolve('api.example.com', [P]);
      // Acepta la petición y nunca responde.
      await world.serveAt(P, 443, { kind: 'stall-headers' }, { tls: { hostname: 'api.example.com', authority: 'trusted' } });
      await world.ctx.publish(llmHttp({ timeoutMs: 8000 }));
      world.ctx.testApp.llm.use(() => {
        world.ctx.testApp.clock.advance(89_500);
        return finishing(0.01, 'Hola');
      });
      const started = Date.now();
      const res = await world.ctx.conv.create({ flowId: 'llm-http' }).expect(201);
      const elapsed = Date.now() - started;
      expect(res.body.events).toContainEqual({ type: 'http', nodeId: 'h', attempts: 1, status: null, error: 'timeout' });
      expect(elapsed).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThanOrEqual(500 + 1500);
    } finally {
      await world.close();
    }
  });

  it('Coste acumulado', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking(0.01));
    const { id, body } = await ctx.start('faq-ia');
    const costs = [body.conversation.costUsd, (await ctx.say(id, { text: 'uno' })).conversation.costUsd, (await ctx.say(id, { text: 'dos' })).conversation.costUsd];
    [0.01, 0.02, 0.03].forEach((expected, index) => expect(Math.abs(costs[index] - expected)).toBeLessThan(1e-12));
  });

  it('Otro nombre de proveedor', async () => {
    const flow = faq();
    flow.nodes.find((node: any) => node.id === 'asistente').provider = 'barato';
    await ctx.publish(flow);
    const res = await ctx.conv.create({ flowId: 'faq-ia' }).expect(201);
    expect(res.body.conversation).toMatchObject({ status: 'failed', error: { code: 'llm_not_configured', nodeId: 'asistente' } });
    expect(ctx.testApp.llm.requests).toHaveLength(0);
  });

  it('Aviso en el registro', async () => {
    const output = captureOutput();
    const local = await startConversationsContext({ logger: output.logger });
    try {
      await local.publish(faq());
      local.testApp.llm.use({ kind: 'not_configured' });
      const { id } = await local.start('faq-ia');
      const line = output.lines().find((candidate) => candidate.includes(id));
      expect(line).toBeDefined();
      expect(line).toContain('asistente');
      expect(line).toContain('principal');
      expect(line).toContain('llm_not_configured');
      expect(line).toMatch(/^warn /);
    } finally {
      await local.reset();
      await local.close();
    }
  });

  it('Default json en el límite', async () => {
    let deep: unknown = 'hoja';
    for (let level = 0; level < 997; level += 1) deep = [deep];
    const flow = pregunta();
    flow.variables.push({ name: 'j', type: 'json', default: deep });
    await ctx.publish(flow);
    const { id } = await ctx.start('pregunta');
    const sent = await ctx.say(id, { text: 'Ana' });
    expect(sent.conversation).toMatchObject({ status: 'ended', outcome: 'ok' });
  });
});

describe('presupuesto de coste (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext({ costLimitUsd: 0.02 });
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('Presupuesto agotado entre avances', async () => {
    await ctx.publish(faq());
    ctx.testApp.llm.use(keepTalking(0.01));
    const { id, body } = await ctx.start('faq-ia');
    expect(body.conversation).toMatchObject({ status: 'waiting', pendingInput: { nodeId: 'asistente' } });
    const second = await ctx.say(id, { text: 'uno' });
    expect(second.conversation).toMatchObject({ status: 'waiting', costLimitReached: false });
    expect(ctx.testApp.llm.requests).toHaveLength(2);

    const third = await ctx.say(id, { text: 'dos' });
    // La tercera operación no llama al proveedor.
    expect(ctx.testApp.llm.requests).toHaveLength(2);
    expect(third.events).toContainEqual({ type: 'llm', nodeId: 'asistente', turns: 3, costUsd: 0.02, reason: 'provider_error' });
    expect(third.events.map((event: any) => [event.type, event.nodeId])).toEqual(expect.arrayContaining([['message', 'pedir-email'], ['input', 'pedir-email']]));
    expect(third.conversation.costLimitReached).toBe(true);
    expect(Math.abs(third.conversation.costUsd - 0.02)).toBeLessThan(1e-12);
    // La bandera se queda puesta.
    expect((await ctx.conv.get(id).expect(200)).body.costLimitReached).toBe(true);
  });
});

describe('presupuesto dentro de un avance (e2e)', () => {
  let ctx: ConversationsContext;

  beforeAll(async () => {
    ctx = await startConversationsContext({ costLimitUsd: 0.01 });
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('Presupuesto agotado dentro de un avance', async () => {
    await ctx.publish(dobleLlm());
    ctx.testApp.llm.use(finishing(0.01, 'Hola'));
    const res = await ctx.conv.create({ flowId: 'doble-llm' }).expect(201);
    expect(ctx.testApp.llm.requests).toHaveLength(1);
    expect(res.body.events).toContainEqual({ type: 'llm', nodeId: 'b', turns: 1, costUsd: 0, reason: 'provider_error' });
    expect(res.body.conversation).toMatchObject({ status: 'ended', outcome: 'fin', costLimitReached: true });
  });
});
