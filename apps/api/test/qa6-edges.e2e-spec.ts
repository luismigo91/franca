import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { finishing, keepTalking } from './helpers/conversations-llm.js';
import {
  faq,
  hola,
  pregunta,
  startConversationsContext,
  type ConversationsContext,
} from './helpers/conversations.js';
import { captureOutput } from './helpers/output.js';
import { rawRequest } from './helpers/raw.js';

const KIB_64 = 65_536;
const MINUTE = 60_000;
const JSON_HEADERS = { 'content-type': 'application/json' };

/** Un flujo de un nodo `set` + `end` que usa una variable de contacto `name` de tipo `type`. */
function contactFlow(id: string, type: string, assignment: unknown): any {
  return {
    specVersion: '0.1',
    id,
    name: id,
    variables: [{ name: 'edad', type, scope: 'contact' }],
    start: assignment === undefined ? 'fin' : 'fijar',
    nodes: [
      ...(assignment === undefined
        ? []
        : [
            {
              id: 'fijar',
              type: 'set',
              assignments: [{ variable: 'edad', value: assignment }],
              next: 'fin',
            },
          ]),
      {
        id: 'fin',
        type: 'end',
        content: [{ kind: 'text', text: 'edad={{edad}}' }],
      },
    ],
  };
}

describe('qa6: contactos, entradas y caducidad en los bordes (e2e)', () => {
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
      headers: headers ?? (body === undefined ? {} : JSON_HEADERS),
      body,
    });

  describe('valores de contacto compartidos entre flujos', () => {
    it('un valor guardado por un flujo con otro tipo de variable no rompe la creación en otro flujo (no es 500)', async () => {
      await ctx.publish(contactFlow('escribe-num', 'number', 5));
      await ctx.publish(contactFlow('lee-texto', 'string', undefined));
      await ctx.start('escribe-num', { contactId: 'qa6-tipo' });
      const read = await ctx.conv.create({
        flowId: 'lee-texto',
        contactId: 'qa6-tipo',
      });
      expect(read.status, read.text).toBe(201);
      expect(output.text()).not.toContain('invalid_contact');
    });

    it('el mismo valor lo leen dos flujos que declaran el mismo tipo, y sin contactId ninguno lo ve', async () => {
      await ctx.publish(contactFlow('escribe-num', 'number', 5));
      await ctx.publish(contactFlow('lee-num', 'number', undefined));
      await ctx.start('escribe-num', { contactId: 'qa6-n' });
      expect(
        (await ctx.start('lee-num', { contactId: 'qa6-n' })).body.events[0]
          .content[0].text,
      ).toBe('edad=5');
      expect((await ctx.start('lee-num')).body.events[0].content[0].text).toBe(
        'edad=',
      );
    });

    it('un valor falsy (0, false, cadena vacía) se guarda y se lee; solo null borra', async () => {
      for (const [type, value, text] of [
        ['number', 0, 'edad=0'],
        ['boolean', false, 'edad=false'],
        ['string', '', 'edad='],
      ] as const) {
        await ctx.reset();
        await ctx.publish(contactFlow('escribe', type, value));
        await ctx.publish(contactFlow('lee', type, undefined));
        await ctx.start('escribe', { contactId: 'qa6-falsy' });
        const rows = await ctx.prisma.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*) AS n FROM contact_values WHERE contact_id = 'qa6-falsy'`;
        expect(Number(rows[0]!.n), `${type}=${JSON.stringify(value)}`).toBe(1);
        expect(
          (await ctx.start('lee', { contactId: 'qa6-falsy' })).body.events[0]
            .content[0].text,
          type,
        ).toBe(text);
      }
    });

    it('contactId en los bordes del patrón: salto de línea final, Unicode, 64 y 65 caracteres, y en la ruta de borrado', async () => {
      await ctx.publish(hola());
      for (const contactId of [
        'c-1\n',
        'cé1',
        'Ａbc',
        'a'.repeat(65),
        'c.1',
        'c/1',
        ' c1',
      ]) {
        const res = await ctx.conv
          .create({ flowId: 'hola', contactId })
          .expect(400);
        expect(res.body.error, JSON.stringify(contactId)).toBe(
          'invalid_request',
        );
      }
      for (const contactId of ['_', '-', '0', 'Z'.repeat(64)])
        await ctx.conv.create({ flowId: 'hola', contactId }).expect(201);
      for (const path of [
        '/contacts/c-1%0A',
        '/contacts/c%C3%A91',
        '/contacts/' + 'a'.repeat(65),
        '/contacts/c.1',
        '/contacts/%20',
      ]) {
        const res = await raw('DELETE', path);
        expect(res.status, path).toBe(400);
        expect(res.json.error, path).toBe('invalid_request');
      }
      expect((await raw('DELETE', '/contacts/' + 'Z'.repeat(64))).status).toBe(
        204,
      );
      expect((await raw('DELETE', '/contacts/')).status).toBe(404);
      expect((await raw('DELETE', '/contacts')).status).toBe(404);
    });

    it('contactId que parece un id de Object.prototype (constructor, __proto__, toString) es un contacto como cualquier otro', async () => {
      await ctx.publish(contactFlow('escribe-num', 'number', 7));
      await ctx.publish(contactFlow('lee-num', 'number', undefined));
      for (const contactId of [
        'constructor',
        '__proto__',
        'toString',
        'hasOwnProperty',
      ]) {
        await ctx.start('escribe-num', { contactId });
        expect(
          (await ctx.start('lee-num', { contactId })).body.events[0].content[0]
            .text,
          contactId,
        ).toBe('edad=7');
        expect((await ctx.conv.removeContact(contactId)).status).toBe(204);
        expect(
          (await ctx.start('lee-num', { contactId })).body.events[0].content[0]
            .text,
          contactId,
        ).toBe('edad=');
      }
    });

    it('un contacto recreado tras borrarse empieza sin valores y sus conversaciones antiguas no reaparecen', async () => {
      await ctx.publish(contactFlow('escribe-num', 'number', 5));
      await ctx.publish(contactFlow('lee-num', 'number', undefined));
      const old = await ctx.start('escribe-num', { contactId: 'qa6-re' });
      await ctx.conv.removeContact('qa6-re').expect(204);
      await ctx.conv.get(old.id).expect(404);
      expect(
        (await ctx.start('lee-num', { contactId: 'qa6-re' })).body.events[0]
          .content[0].text,
      ).toBe('edad=');
      expect((await ctx.conv.list().expect(200)).body.total).toBe(1);
    });
  });

  describe('entradas que el cliente puede mandar', () => {
    it('una propiedad extra anidada a 30 000 niveles dentro del límite de 64 KiB no produce 500', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      const depth = 30_000;
      const body = `{"input":{"text":"Ana","x":${'['.repeat(depth)}${']'.repeat(depth)}}}`;
      expect(Buffer.byteLength(body)).toBeLessThan(KIB_64);
      const res = await raw('POST', `/conversations/${id}/inputs`, body);
      expect(res.status, res.text.slice(0, 200)).toBeLessThan(500);
      expect([200, 400]).toContain(res.status);
      // Sea cual sea la decisión, la conversación sigue consistente y se puede leer y continuar.
      const after = (await ctx.conv.get(id).expect(200)).body;
      expect(after.revision).toBe(res.status === 200 ? 2 : 1);
      if (res.status === 400)
        await ctx.conv.send(id, { input: { text: 'Ana' } }).expect(200);
      expect((await ctx.conv.transcript(id).expect(200)).status).toBe(200);
    });

    it('un input con 30 000 niveles de anidamiento en lugar de objeto se rechaza como invalid_input', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      const depth = 30_000;
      const res = await raw(
        'POST',
        `/conversations/${id}/inputs`,
        `{"input":${'['.repeat(depth)}${']'.repeat(depth)}}`,
      );
      expect(res.status, res.text.slice(0, 200)).toBe(400);
      expect(res.json.error).toBe('invalid_input');
    });

    it('texto con NUL, sustitutos sueltos y emojis se guarda y se devuelve idéntico en la transcripción', async () => {
      await ctx.publish(pregunta());
      for (const text of [
        'a\u0000b',
        '\ud800',
        'x\udc00y',
        '\u{1F600}Ana',
        '  ',
        '"\\',
      ]) {
        await ctx.reset();
        await ctx.publish(pregunta());
        const { id } = await ctx.start('pregunta');
        const res = await ctx.conv.send(id, { input: { text } });
        expect(res.status, JSON.stringify(text)).toBe(200);
        const items = (await ctx.conv.transcript(id).expect(200)).body
          .items as any[];
        expect(
          items.find((item) => item.role === 'user').input.text,
          JSON.stringify(text),
        ).toBe(text);
      }
    });

    it('formas de input que el motor rechaza son 400 invalid_input y no cambian ni cobran nada', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      const bad: unknown[] = [
        null,
        5,
        'texto',
        true,
        [],
        [{ text: 'Ana' }],
        {},
        { text: 5 },
        { text: null },
        { text: ['Ana'] },
        { text: { a: 1 } },
        { choice: 'x' },
      ];
      for (const input of bad) {
        const res = await ctx.conv.send(id, { input });
        expect(res.status, JSON.stringify(input)?.slice(0, 60)).toBe(400);
        expect(res.body.error).toBe('invalid_input');
      }
      const after = (await ctx.conv.get(id).expect(200)).body;
      expect(after).toMatchObject({
        revision: 1,
        processing: false,
        costUsd: 0,
      });
      expect(
        (await ctx.conv.transcript(id).expect(200)).body.items.filter(
          (item: any) => item.role === 'user',
        ),
      ).toEqual([]);
    });

    it('un texto de más de 4096 unidades es un reintento too_long (200), no un rechazo, y no cuesta nada', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      const res = await ctx.conv
        .send(id, { input: { text: 'a'.repeat(4097) } })
        .expect(200);
      expect(res.body.conversation).toMatchObject({
        revision: 2,
        status: 'waiting',
        costUsd: 0,
      });
      expect(
        res.body.events.find((event: any) => event.type === 'input'),
      ).toMatchObject({ attempt: 2, reason: 'too_long' });
      const ok = await ctx.conv
        .send(id, { input: { text: 'a'.repeat(4096) } })
        .expect(200);
      expect(ok.body.conversation.status).toBe('ended');
    });

    it('el cuerpo con input duplicado toma el último, y input heredado (__proto__) no cuenta', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      const proto = await raw(
        'POST',
        `/conversations/${id}/inputs`,
        '{"__proto__":{"input":{"text":"Ana"}}}',
      );
      expect(proto.status).toBe(400);
      expect(proto.json.error).toBe('invalid_request');
      const dup = await raw(
        'POST',
        `/conversations/${id}/inputs`,
        '{"input":{"text":"Ana"},"input":{"choice":"x"}}',
      );
      expect(dup.status).toBe(400);
      expect(dup.json.error).toBe('invalid_input');
    });
  });

  describe('orden de comprobación y frontera', () => {
    it('413 va antes que 415 y que invalid_json, 415 antes que invalid_json, y invalid_json antes que 404 (inputs y creación)', async () => {
      await ctx.publish(hola());
      const missing =
        '/conversations/00000000-0000-4000-8000-000000000000/inputs';
      for (const path of [missing, '/conversations']) {
        const big = 'x'.repeat(KIB_64 + 1);
        expect(
          (await raw('POST', path, big, { 'content-type': 'text/plain' }))
            .status,
          `${path} 413>415`,
        ).toBe(413);
        expect(
          (await raw('POST', path, big, JSON_HEADERS)).status,
          `${path} 413>400`,
        ).toBe(413);
        expect(
          (await raw('POST', path, '{', { 'content-type': 'text/plain' }))
            .status,
          `${path} 415>400`,
        ).toBe(415);
        const bad = await raw('POST', path, '{', JSON_HEADERS);
        expect([bad.status, bad.json.error], `${path} 400>404`).toEqual([
          400,
          'invalid_json',
        ]);
      }
      const gz = await raw('POST', missing, '{}', {
        ...JSON_HEADERS,
        'content-encoding': 'gzip',
      });
      expect([gz.status, gz.json.error]).toEqual([
        415,
        'unsupported_media_type',
      ]);
    });

    it('el límite de 64 KiB vale con consulta, barra final, mayúsculas, y sin Content-Length (chunked)', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      const text = JSON.stringify({ input: { text: '   ' } });
      const over = text + ' '.repeat(KIB_64 + 1 - text.length);
      const exact = text + ' '.repeat(KIB_64 - text.length);
      for (const path of [
        `/conversations/${id}/inputs?x=1`,
        `/conversations/${id}/inputs/`,
        `/CONVERSATIONS/${id}/INPUTS`,
        `/conversations/${id}/inputs/?a=b`,
      ]) {
        expect((await raw('POST', path, over)).status, path).toBe(413);
      }
      for (const path of [
        `/conversations/${id}/inputs?x=1`,
        `/CONVERSATIONS/${id}/INPUTS`,
      ]) {
        expect((await raw('POST', path, exact)).status, path).toBe(200);
      }
      // Sin Content-Length (chunked): el límite también se aplica al cuerpo que va llegando.
      for (const [size, status] of [
        [KIB_64 + 1, 413],
        [KIB_64, 200],
      ] as const) {
        const response = await new Promise<{ status: number; text: string }>(
          (resolve, reject) => {
            const request = httpRequest(
              {
                host: '127.0.0.1',
                port: ctx.testApp.port,
                method: 'POST',
                path: `/conversations/${id}/inputs`,
                headers: { ...JSON_HEADERS, 'transfer-encoding': 'chunked' },
              },
              (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                  resolve({
                    status: res.statusCode ?? 0,
                    text: Buffer.concat(chunks).toString('utf8'),
                  }),
                );
              },
            );
            request.on('error', reject);
            const body = text + ' '.repeat(size - text.length);
            for (let offset = 0; offset < body.length; offset += 8192)
              request.write(body.slice(offset, offset + 8192));
            request.end();
          },
        );
        expect(response.status, `${size}: ${response.text}`).toBe(status);
      }
    });

    it('Host y Origin se comprueban antes que el cuerpo en todas las rutas de conversaciones y contactos', async () => {
      await ctx.publish(hola());
      const { id } = await ctx.start('hola', { contactId: 'qa6-host' });
      const routes: [string, string, string | undefined][] = [
        ['POST', '/conversations', '{"flowId":"hola"}'],
        ['GET', '/conversations', undefined],
        ['GET', `/conversations/${id}`, undefined],
        ['GET', `/conversations/${id}/transcript`, undefined],
        ['POST', `/conversations/${id}/inputs`, '{"input":{}}'],
        ['DELETE', `/conversations/${id}`, undefined],
        ['DELETE', '/contacts/qa6-host', undefined],
      ];
      for (const [method, path, body] of routes) {
        const host = await raw(method, path, body, {
          ...JSON_HEADERS,
          host: 'evil.example:3001',
        });
        expect(
          [host.status, host.json?.error],
          `${method} ${path} host`,
        ).toEqual([403, 'forbidden_host']);
        const origin = await raw(method, path, body, {
          ...JSON_HEADERS,
          origin: 'http://localhost:3000',
        });
        expect(
          [origin.status, origin.json?.error],
          `${method} ${path} origin`,
        ).toEqual([403, 'forbidden_origin']);
      }
      expect((await ctx.conv.get(id).expect(200)).body.revision).toBe(1);
      expect((await ctx.conv.list().expect(200)).body.total).toBe(1);
    });
  });

  describe('versión fijada y caducidad', () => {
    it('version explícita en los bordes: 2147483647 no existe (404, no 500), 2147483648 es 400, 1 sin publicar es 404', async () => {
      await ctx.publish(hola());
      const maxed = await ctx.conv
        .create({ flowId: 'hola', version: 2147483647 })
        .expect(404);
      expect(maxed.body.error).toBe('version_not_found');
      for (const version of [
        2147483648,
        0,
        -1,
        1.5,
        '1',
        true,
        [],
        {},
        1e300,
      ]) {
        const res = await ctx.conv.create({ flowId: 'hola', version });
        expect([res.status, res.body.error], JSON.stringify(version)).toEqual([
          400,
          'invalid_request',
        ]);
      }
      await ctx.conv.create({ flowId: 'hola', version: 2 }).expect(404);
      await ctx.conv.create({ flowId: 'hola', version: 1 }).expect(201);
    });

    it('sessionTimeoutMinutes 1: caduca exactamente a los 60 s (now >= expiresAt) y no un milisegundo antes', async () => {
      const flow = pregunta();
      flow.settings.sessionTimeoutMinutes = 1;
      await ctx.publish(flow);
      const created = await ctx.start('pregunta');
      const { createdAt, expiresAt } = created.body.conversation;
      expect(Date.parse(expiresAt) - Date.parse(createdAt)).toBe(MINUTE);
      ctx.testApp.clock.set(new Date(Date.parse(expiresAt) - 1));
      expect((await ctx.conv.get(created.id).expect(200)).body.status).toBe(
        'waiting',
      );
      ctx.testApp.clock.set(new Date(Date.parse(expiresAt) - 1));
      expect(
        (await ctx.conv.list('?status=waiting').expect(200)).body.total,
      ).toBe(1);
      ctx.testApp.clock.set(new Date(expiresAt));
      expect(
        (await ctx.conv.list('?status=waiting').expect(200)).body.total,
      ).toBe(0);
      ctx.testApp.clock.set(new Date(expiresAt));
      expect(
        (await ctx.conv.list('?status=expired').expect(200)).body.total,
      ).toBe(1);
      ctx.testApp.clock.set(new Date(expiresAt));
      const late = await ctx.conv
        .send(created.id, { input: { text: 'Ana' } })
        .expect(409);
      expect(late.body.error).toBe('conversation_expired');
    });

    it('sessionTimeoutMinutes 525600 se respeta, 525601 y 2^53 se recortan a 525600', async () => {
      for (const minutes of [525_600, 525_601, Number.MAX_SAFE_INTEGER]) {
        await ctx.reset();
        const flow = pregunta();
        flow.settings.sessionTimeoutMinutes = minutes;
        await ctx.publish(flow);
        const { body } = await ctx.start('pregunta');
        const { createdAt, expiresAt } = body.conversation;
        expect(
          Date.parse(expiresAt) - Date.parse(createdAt),
          String(minutes),
        ).toBe(525_600 * MINUTE);
      }
    });

    it('una entrada que se rechaza (400) no renueva el plazo ni cambia updatedAt', async () => {
      await ctx.publish(pregunta());
      const created = await ctx.start('pregunta');
      ctx.testApp.clock.advance(10 * MINUTE);
      await ctx.conv.send(created.id, { input: { choice: 'x' } }).expect(400);
      const after = (await ctx.conv.get(created.id).expect(200)).body;
      expect(after.expiresAt).toBe(created.body.conversation.expiresAt);
      expect(after.updatedAt).toBe(created.body.conversation.updatedAt);
    });

    it('la conversación sigue fijada a su versión aunque se publique otra con otro flujo y aunque el flujo se borre', async () => {
      await ctx.publish(pregunta());
      const { id } = await ctx.start('pregunta');
      const v2 = pregunta();
      v2.nodes[1].outcome = 'otro';
      await ctx.flows.update('pregunta', v2, '*').expect(200);
      await ctx.flows.publish('pregunta').expect(201);
      await ctx.flows.remove('pregunta').expect(204);
      const sent = await ctx.say(id, { text: 'Ana' });
      expect(sent.conversation).toMatchObject({
        version: 1,
        status: 'ended',
        outcome: 'ok',
      });
    });
  });

  describe('listados y transcripción en los bordes', () => {
    it('offset 2147483647 da página vacía con el total real en listado y transcripción; 2147483648 es invalid_query', async () => {
      await ctx.publish(hola());
      const { id } = await ctx.start('hola');
      for (const path of [
        '/conversations',
        `/conversations/${id}/transcript`,
      ]) {
        const res = (await raw('GET', `${path}?offset=2147483647&limit=100`))
          .json;
        expect(res, path).toMatchObject({
          items: [],
          offset: 2147483647,
          limit: 100,
        });
        expect(res.total, path).toBeGreaterThanOrEqual(1);
        const over = await raw('GET', `${path}?offset=2147483648`);
        expect([over.status, over.json.error], path).toEqual([
          400,
          'invalid_query',
        ]);
      }
    });

    it('filtros: flowId válido e inexistente da lista vacía; status en mayúsculas, vacío y como array es invalid_query', async () => {
      await ctx.publish(hola());
      await ctx.start('hola');
      expect(
        (await ctx.conv.list('?flowId=otro-flujo').expect(200)).body,
      ).toMatchObject({ items: [], total: 0 });
      for (const query of [
        '?status=ENDED',
        '?status=',
        '?flowId=',
        '?flowId=hola&flowId=hola',
        '?limit=',
        '?limit=1.5',
        '?limit=0x10',
        '?offset=1e3',
      ]) {
        const res = await ctx.conv.list(query);
        expect([res.status, res.body.error], query).toEqual([
          400,
          'invalid_query',
        ]);
      }
    });

    it('la transcripción valida la consulta antes que el id y un id válido inexistente es 404', async () => {
      const nobody = '00000000-0000-4000-8000-000000000000';
      expect((await ctx.conv.transcript(nobody, '?limit=0')).body.error).toBe(
        'invalid_query',
      );
      expect((await ctx.conv.transcript(nobody)).body.error).toBe(
        'conversation_not_found',
      );
      expect(
        (await ctx.conv.transcript('no-es-uuid', '?limit=0')).body.error,
      ).toBe('invalid_query');
    });
  });

  describe('coste y proveedor', () => {
    it('costes no válidos del proveedor (negativo, NaN, Infinity, texto) no restan ni rompen el contador', async () => {
      await ctx.publish(faq());
      ctx.testApp.llm.use(keepTalking(0.01));
      const { id } = await ctx.start('faq-ia');
      let cost = 0.01;
      for (const bad of [
        -5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        '9' as unknown as number,
      ]) {
        ctx.testApp.llm.use({
          kind: 'turn',
          text: 'x',
          slots: {},
          done: false,
          costUsd: bad,
        });
        const res = await ctx.conv.send(id, { input: { text: 'uno' } });
        expect(res.status, String(bad)).toBeLessThan(500);
        if (res.status === 200) {
          expect(
            Number.isFinite(res.body.conversation.costUsd),
            String(bad),
          ).toBe(true);
          expect(res.body.conversation.costUsd).toBeGreaterThanOrEqual(
            cost - 1e-12,
          );
          cost = res.body.conversation.costUsd;
        }
      }
    });

    it('un proveedor que rechaza con un mensaje que lleva un secreto no filtra el mensaje ni a la respuesta ni al registro', async () => {
      await ctx.publish(faq());
      ctx.testApp.llm.use(() => {
        throw new Error('SECRETO-DEL-PROVEEDOR sk-qa6-0000'); // gitleaks:allow
      });
      const res = await ctx.conv.create({ flowId: 'faq-ia' });
      expect(res.status, res.text).toBeLessThan(500);
      expect(res.text).not.toContain('SECRETO-DEL-PROVEEDOR');
      expect(output.text()).not.toContain('SECRETO-DEL-PROVEEDOR');
    });

    it('un turno que termina el nodo con texto de usuario solo aparece en la transcripción, no en el registro', async () => {
      await ctx.publish(faq());
      ctx.testApp.llm.use(finishing(0.01, 'MARCA-QA6-RESPUESTA'));
      const { id } = await ctx.start('faq-ia');
      await ctx.conv.transcript(id).expect(200);
      expect(output.text()).not.toContain('MARCA-QA6-RESPUESTA');
    });
  });
});
