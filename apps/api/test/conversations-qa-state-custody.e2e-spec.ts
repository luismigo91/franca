import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { finishing, keepTalking } from './helpers/conversations-llm.js';
import {
  faq,
  hola,
  leads,
  pregunta,
  startConversationsContext,
  type ConversationsContext,
} from './helpers/conversations.js';
import { captureOutput } from './helpers/output.js';
import { rawRequest } from './helpers/raw.js';

/** Claves y marcas que solo existen en el estado del motor (`SessionState`). */
const STATE_MARKS = [
  'stateVersion',
  '"variables"',
  '"collected"',
  '"contact"',
  '"conversation"\\s*:\\s*\\{\\s*"messages"',
  'claimToken',
  'claim_token',
  'transcriptLength',
];
const EMAIL = 'qa6-pii@example.com';

describe('QA: el estado del motor no sale por ninguna ruta, error ni registro (e2e)', () => {
  let ctx: ConversationsContext;
  const output = captureOutput();

  beforeAll(async () => {
    ctx = await startConversationsContext({ logger: output.logger });
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const raw = (
    method: string,
    path: string,
    body?: string,
    headers?: Record<string, string>,
  ) =>
    rawRequest(ctx.testApp.port, {
      method,
      path,
      headers:
        headers ??
        (body === undefined ? {} : { 'content-type': 'application/json' }),
      body,
    });

  function expectNoState(label: string, text: string): void {
    for (const mark of STATE_MARKS)
      expect(text, `${label}: ${mark}`).not.toMatch(new RegExp(mark));
  }

  it('respuestas de éxito y de error de las siete rutas, en cada estado de la conversación, sin estado ni claves de reclamación', async () => {
    await ctx.publish(leads());
    await ctx.publish(faq());
    await ctx.publish(pregunta());
    ctx.testApp.llm.use(keepTalking(0.01, 'respuesta del modelo'));
    const waitingLeads = await ctx.start('captacion-leads', {
      contactId: 'qa6-s',
    });
    const waitingFaq = await ctx.start('faq-ia', { contactId: 'qa6-s' });
    const expiring = await ctx.start('pregunta');
    await ctx.say(waitingLeads.id, { text: 'Ana' });
    await ctx.say(waitingLeads.id, { text: EMAIL });
    const failed = await ctx.say(waitingLeads.id, { choice: 'grande' });
    expect(failed.conversation.status).toBe('failed');
    const ended = await ctx.start('pregunta');
    await ctx.say(ended.id, { text: 'Ana' });
    ctx.testApp.clock.advance(31 * 60_000);

    const bodies: [string, string][] = [];
    const record = async (label: string, call: Promise<{ text: string }>) =>
      bodies.push([label, (await call).text]);
    for (const [name, id] of [
      ['waitingFaq', waitingFaq.id],
      ['failed', waitingLeads.id],
      ['ended', ended.id],
      ['expired', expiring.id],
    ] as const) {
      await record(`GET ${name}`, ctx.conv.get(id));
      await record(`transcript ${name}`, ctx.conv.transcript(id, '?limit=100'));
      await record(`send ${name}`, ctx.conv.send(id, { input: { text: 'x' } }));
      await record(
        `send stale ${name}`,
        ctx.conv.send(id, { input: { text: 'x' } }, '"99"'),
      );
      await record(`send bad ${name}`, ctx.conv.send(id, { input: 5 }));
      await record(
        `send state ${name}`,
        ctx.conv.send(id, {
          input: { text: 'x' },
          state: { stateVersion: 1 },
        } as never),
      );
    }
    await record('list', ctx.conv.list('?limit=100'));
    await record('list failed', ctx.conv.list('?status=failed'));
    await record('list bad', ctx.conv.list('?status=zzz'));
    await record('create bad', ctx.conv.create({ flowId: 5 }));
    await record('create missing', ctx.conv.create({ flowId: 'nada' }));
    await record(
      'create ended',
      ctx.conv.create({ flowId: 'pregunta', contactId: 'qa6-s' }),
    );
    await record('delete contact bad', ctx.conv.removeContact('a.b'));
    await record('404', Promise.resolve(raw('GET', '/conversations/x/y/z')));
    for (const [label, text] of bodies) expectNoState(label, text);

    // Fuera de la transcripción, el email que escribió el usuario no vuelve a salir en ninguna lectura de la conversación.
    for (const [label, text] of bodies.filter(
      ([label]) => label.startsWith('GET') || label.startsWith('list'),
    ))
      expect(text, label).not.toContain(EMAIL);
    // La transcripción sí lleva lo que escribió el usuario, tal cual (el control de que la búsqueda ve algo).
    expect(
      (await ctx.conv.transcript(waitingLeads.id, '?limit=100').expect(200))
        .text,
    ).toContain(EMAIL);
  });

  it('el 500 por un estado guardado inválido no lleva ni una pista del estado ni del código del motor', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta', { contactId: 'qa6-500' });
    await ctx.prisma
      .$executeRaw`UPDATE conversations SET state = '{"stateVersion":1,"flowId":"otro","variables":{"nombre":"MARCA-QA6"}}' WHERE id = ${id}::uuid`;
    const res = await ctx.conv.send(id, { input: { text: 'Ana' } });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'error interno',
      error: 'internal_error',
    });
    expect(res.text).not.toMatch(/state_mismatch|MARCA-QA6|otro/);
    expect(res.headers.etag).toBeUndefined();
    expect(output.text()).not.toContain('MARCA-QA6');
    expectNoState('500', output.text());
  });

  it('el registro de una sesión completa con contacto, llm y errores no contiene estado, entradas, respuestas ni la URL de la base', async () => {
    await ctx.publish(leads());
    await ctx.publish(faq());
    ctx.testApp.llm.use(finishing(0.01, 'MARCA-QA6-LLM'));
    const lead = await ctx.start('captacion-leads', { contactId: 'qa6-log' });
    await ctx.say(lead.id, { text: 'Ana' });
    await ctx.say(lead.id, { text: EMAIL });
    await ctx.conv.send(lead.id, { input: { text: 'MARCA-QA6-IN' } });
    const asked = await ctx.start('faq-ia');
    await ctx.say(asked.id, { text: 'MARCA-QA6-PREGUNTA' });
    await ctx.conv.send(lead.id, { input: { choice: 5 } });
    await ctx.conv.create({ flowId: 'faq-ia', contactId: 'ana@example.com' });
    await ctx.conv.removeContact('qa6-log');
    const text = output.text();
    for (const forbidden of [
      EMAIL,
      'MARCA-QA6-LLM',
      'MARCA-QA6-IN',
      'MARCA-QA6-PREGUNTA',
      'ana@example.com',
      'postgresql://',
      'FRANCA_ANTHROPIC_API_KEY=',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expectNoState('registro', text);
  });

  it('métodos y rutas que no existen responden 404 not_found JSON (nunca 405 ni 500) y no consumen el límite de 64 KiB', async () => {
    await ctx.publish(hola());
    const { id } = await ctx.start('hola');
    const big = JSON.stringify({ pad: 'x'.repeat(70_000) });
    const cases: [string, string, string | undefined][] = [
      ['PUT', `/conversations/${id}`, '{}'],
      ['PATCH', `/conversations/${id}`, '{}'],
      ['DELETE', '/conversations', undefined],
      ['POST', `/conversations/${id}`, '{}'],
      ['GET', `/conversations/${id}/inputs`, undefined],
      ['POST', `/conversations/${id}/transcript`, '{}'],
      ['POST', '/contacts/qa6', '{}'],
      ['GET', '/contacts/qa6', undefined],
      ['DELETE', `/conversations/${id}/inputs`, undefined],
      ['PUT', '/conversations', big],
    ];
    for (const [method, path, body] of cases) {
      const res = await raw(method, path, body);
      expect([res.status, res.json?.error], `${method} ${path}`).toEqual([
        404,
        'not_found',
      ]);
    }
    expect((await ctx.conv.get(id).expect(200)).body.revision).toBe(1);
  });

  it('If-Match: solo un ETag fuerte de la revisión actual, una lista que lo contiene o *; débil, sin comillas, vacío o de otra revisión es 412', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    for (const value of [
      'W/"1"',
      '1',
      '""',
      '"2"',
      '"1" "2"',
      '"01"',
      '"1',
      ' ',
    ]) {
      const res = await raw(
        'POST',
        `/conversations/${id}/inputs`,
        '{"input":{"text":"   "}}',
        { 'content-type': 'application/json', 'if-match': value },
      );
      expect([res.status, res.json?.error], JSON.stringify(value)).toEqual([
        412,
        'revision_mismatch',
      ]);
      expect(res.json.currentRevision).toBe(1);
      expect(res.headers.etag).toBe('"1"');
    }
    expect((await ctx.conv.get(id).expect(200)).body.revision).toBe(1);
    for (const [value, revision] of [
      ['"7", "1"', 2],
      ['*', 3],
      ['"3"', 4],
    ] as const) {
      const res = await raw(
        'POST',
        `/conversations/${id}/inputs`,
        '{"input":{"text":"   "}}',
        { 'content-type': 'application/json', 'if-match': value },
      );
      expect([res.status, res.json?.conversation?.revision], value).toEqual([
        200,
        revision,
      ]);
    }
  });

  it('cuerpos con BOM, UTF-8 inválido y claves duplicadas en las dos rutas POST', async () => {
    await ctx.publish(pregunta());
    const { id } = await ctx.start('pregunta');
    const json = { 'content-type': 'application/json' };
    const bom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('{"input":{"text":"Ana"}}'),
    ]);
    const invalidUtf8 = Buffer.concat([
      Buffer.from('{"input":{"text":"'),
      Buffer.from([0xff]),
      Buffer.from('"}}'),
    ]);
    for (const path of [`/conversations/${id}/inputs`, '/conversations']) {
      for (const [label, body] of [
        ['BOM', bom],
        ['UTF-8 inválido', invalidUtf8],
      ] as const) {
        const res = await rawRequest(ctx.testApp.port, {
          method: 'POST',
          path,
          headers: json,
          body,
        });
        expect([res.status, res.json?.error], `${path} ${label}`).toEqual([
          400,
          'invalid_json',
        ]);
      }
    }
    const dup = await raw(
      'POST',
      '/conversations',
      '{"flowId":"nada","flowId":"pregunta"}',
    );
    expect(dup.status).toBe(201);
    expect(dup.json.conversation.flowId).toBe('pregunta');
  });
});
