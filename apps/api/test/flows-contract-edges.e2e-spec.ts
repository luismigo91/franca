import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase, writeDraftDirectly } from './helpers/database.js';
import { HTTP_NODE, hola, leads } from './helpers/examples.js';
import { rawRequest } from './helpers/raw.js';
import { wireRequest, wireText } from './helpers/wire.js';

/** Los pocos campos extra que documenta cada código de error; todo lo demás es `message` y `error`. */
const EXTRA_KEYS: Record<string, string[]> = {
  invalid_flow: ['issues', 'warnings'],
  literal_credential: ['warnings'],
  revision_mismatch: ['currentRevision'],
};

describe('contrato HTTP de flujos: bordes de rutas, parámetros y precondiciones (e2e)', () => {
  let testApp: TestApp;
  let prisma: PrismaClient;
  let api: ApiClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = createTestPrisma();
    api = client(testApp.server);
  });

  afterAll(async () => {
    await testApp.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const raw = (method: string, path: string, body?: string, headers: Record<string, string> = {}) =>
    rawRequest(testApp.port, {
      method,
      path,
      headers: { host: 'localhost', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body,
    });

  /** Exige un error del contrato: exactamente `message`, `error` y los campos propios de su código. */
  const expectError = (res: { status: number; json: any }, status: number, error: string) => {
    expect(res.status).toBe(status);
    expect(res.json.error).toBe(error);
    expect(typeof res.json.message).toBe('string');
    expect(res.json.message.length).toBeGreaterThan(0);
    expect(Object.keys(res.json).sort()).toEqual(['error', 'message', ...(EXTRA_KEYS[error] ?? [])].sort());
  };

  /** Lo mismo con una respuesta de `supertest` (`body` en vez de `json`). */
  const expectApiError = (res: { status: number; body: any }, status: number, error: string) => expectError({ status: res.status, json: res.body }, status, error);

  describe(':flowId en la ruta', () => {
    const IDS: [string, string][] = [
      ['Hola', 'flow_not_found'],
      ['h%4Fla', 'flow_not_found'],
      ['h%00', 'flow_not_found'],
      ['hola%0A', 'flow_not_found'],
      ['hola%20', 'flow_not_found'],
      ['%20hola', 'flow_not_found'],
      ['%C3%B1', 'flow_not_found'],
      ['hola%2F', 'flow_not_found'],
      ['hola%2Fversions', 'flow_not_found'],
      ['..', 'flow_not_found'],
      ['%2e%2e', 'flow_not_found'],
      ['9a', 'flow_not_found'],
      ['-a', 'flow_not_found'],
      ['_a', 'flow_not_found'],
      ['a%2Bb', 'flow_not_found'],
      ['a%5Cb', 'flow_not_found'],
      ['a'.repeat(65), 'flow_not_found'],
      ['a'.repeat(5000), 'flow_not_found'],
      ['%FF', 'not_found'],
      ['%', 'not_found'],
      ['%E0%A4%A', 'not_found'],
    ];

    it.each(IDS)('un id %j responde 404 %s en lectura, escritura, publicación y borrado', async (id, error) => {
      const body = JSON.stringify(hola());
      const responses = [
        await raw('GET', `/flows/${id}`),
        await raw('PUT', `/flows/${id}`, body, { 'if-match': '*' }),
        await raw('DELETE', `/flows/${id}`),
        await raw('POST', `/flows/${id}/versions`),
        await raw('GET', `/flows/${id}/versions`),
        await raw('GET', `/flows/${id}/versions/1`),
      ];
      for (const res of responses) expectError(res, 404, error);
    });

    it('un id de 64 caracteres, el máximo, se crea y se lee; con 65 no existe', async () => {
      const id = `a${'b'.repeat(63)}`;
      await api.create({ ...hola(), id }).expect(201);
      const res = await raw('GET', `/flows/${id}`);
      expect(res.status).toBe(200);
      expect(res.json.id).toBe(id);
      expectError(await raw('GET', `/flows/${id}x`), 404, 'flow_not_found');
    });

    it('los id de ruta reservados por Nest o por JavaScript son flujos normales', async () => {
      for (const id of ['validate', 'versions', 'constructor']) {
        await api.create({ ...hola(), id, start: 'fin' }).expect(201);
        expect((await api.get(id).expect(200)).body.id).toBe(id);
        expect((await api.publish(id).expect(201)).body.flowId).toBe(id);
      }
      for (const id of ['__proto__', 'toString', 'hasOwnProperty']) {
        const res = await api.create({ ...hola(), id });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_flow');
      }
    });

    it('un id con salto de línea o espacio al final en el cuerpo es inválido', async () => {
      for (const id of ['hola\n', 'hola ', ' hola', 'hola\u0000']) {
        const res = await api.create({ ...hola(), id });
        expect(res.status, JSON.stringify(id)).toBe(400);
        expect(res.body.error).toBe('invalid_flow');
      }
      expect(await prisma.flow.count()).toBe(0);
    });
  });

  describe(':version en la ruta', () => {
    beforeEach(async () => {
      await api.create(hola()).expect(201);
      await api.publish('hola').expect(201);
    });

    it.each(['0', '01', '1.0', '-1', '1e3', '+1', '0x1', '%201', '1%00', 'latest', '2147483647', '2147483648', '9'.repeat(400), '%D9%A3', '%EF%BC%91'])(
      'la versión %j no existe: 404 version_not_found',
      async (version) => {
        expectError(await raw('GET', `/flows/hola/versions/${version}`), 404, 'version_not_found');
      },
    );

    it('una versión con % mal formado es una ruta que no existe', async () => {
      expectError(await raw('GET', '/flows/hola/versions/%FF'), 404, 'not_found');
    });

    it('la versión 1 se lee, y con el flujo borrado la ruta de versiones deja de existir', async () => {
      expect((await raw('GET', '/flows/hola/versions/1')).status).toBe(200);
      await api.remove('hola').expect(204);
      for (const version of ['1', '2', '0', 'latest']) expectError(await raw('GET', `/flows/hola/versions/${version}`), 404, 'flow_not_found');
      expectError(await raw('GET', '/flows/hola/versions'), 404, 'flow_not_found');
    });
  });

  describe('parámetros de listado', () => {
    beforeEach(async () => {
      await api.create(hola()).expect(201);
      await api.publish('hola').expect(201);
    });

    const INVALID = [
      'limit=0',
      'limit=101',
      'limit=-1',
      'limit=abc',
      'limit=',
      'limit',
      'limit=1.0',
      'limit=1e1',
      'limit=+1',
      'limit=%201',
      'limit=1%20',
      'limit=%EF%BC%91',
      'limit=0x10',
      'limit=1&limit=1',
      'limit=1&limit=2&limit=3',
      'offset=-1',
      'offset=',
      'offset',
      'offset=2147483648',
      'offset=99999999999999999999',
      'offset=1.5',
      'offset=0x10',
      'offset=1&offset=1',
      'published=TRUE',
      'published=1',
      'published=si',
      'published=',
      'published',
      'published=true&published=true',
      'published=true&published=false',
      'limit=5&offset=abc',
      'limit=abc&offset=5',
    ];
    const VALID = [
      '',
      'limit=1',
      'limit=100',
      'offset=0',
      'offset=2147483647',
      'published=true',
      'published=false',
      'limit=10&offset=1&published=true',
      'orden=nombre',
      '__proto__=1',
      'constructor=1',
      'LIMIT=0',
      'limit=1&',
      '&limit=1',
    ];

    it.each(INVALID)('GET /flows?%s responde 400 invalid_query', async (query) => {
      const res = await raw('GET', `/flows?${query}`);
      expectError(res, 400, 'invalid_query');
    });

    it.each(VALID)('GET /flows?%s responde 200', async (query) => {
      const res = await raw('GET', `/flows?${query}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.json)).toEqual(['items', 'total', 'limit', 'offset']);
    });

    it('los mismos parámetros se validan igual en el historial de versiones', async () => {
      for (const query of ['limit=0', 'limit=101', 'limit=1&limit=2', 'offset=2147483648', 'published=si', 'limit=1.5']) {
        expectError(await raw('GET', `/flows/hola/versions?${query}`), 400, 'invalid_query');
      }
      for (const query of ['', 'limit=1', 'limit=100', 'offset=2147483647', 'orden=nombre']) {
        expect((await raw('GET', `/flows/hola/versions?${query}`)).status, query).toBe(200);
      }
    });

    it('un offset enorme da una página vacía con el total', async () => {
      const res = await raw('GET', '/flows?offset=2147483647');
      expect(res.json).toEqual({ items: [], total: 1, limit: 20, offset: 2147483647 });
    });

    it('un listado se pagina sin repetir ni perder flujos y con el orden del listado completo', async () => {
      for (let index = 0; index < 23; index++) await api.create({ ...hola(), id: `f${String(index).padStart(2, '0')}` }).expect(201);
      const all = (await raw('GET', '/flows?limit=100')).json;
      expect(all.total).toBe(24);
      const paged: string[] = [];
      for (let offset = 0; offset < 30; offset += 5) {
        const page = (await raw('GET', `/flows?limit=5&offset=${offset}`)).json;
        expect(page.total).toBe(24);
        paged.push(...page.items.map((item: { id: string }) => item.id));
      }
      expect(paged).toEqual(all.items.map((item: { id: string }) => item.id));
      expect(new Set(paged).size).toBe(24);
    });

    it('a igual fecha de actualización, el orden es el del código de carácter del id, también entre páginas', async () => {
      const ids = ['ab', 'a-c', 'a_d', 'a0', 'b', 'aa'];
      for (const id of ids) await api.create({ ...hola(), id }).expect(201);
      await prisma.$executeRaw`UPDATE flows SET updated_at = '2026-10-17T10:00:00.000Z'`;
      const expected = ['a-c', 'a0', 'a_d', 'aa', 'ab', 'b', 'hola'].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const firstPage = (await raw('GET', '/flows?limit=3&offset=0')).json.items.map((item: { id: string }) => item.id);
      const secondPage = (await raw('GET', '/flows?limit=4&offset=3')).json.items.map((item: { id: string }) => item.id);
      expect([...firstPage, ...secondPage]).toEqual(expected);
    });
  });

  describe('If-Match', () => {
    beforeEach(async () => {
      await api.create(hola()).expect(201);
    });

    const ACCEPTED = ['*', '"1"', ' "1" ', '"1","2"', '"2", "1"', '* '];
    const REJECTED = ['W/"1"', 'w/"1"', '1', '"01"', '""', '', ',', '"1" "2"', "'1'", '"1', '1"', '"1"x', '*x', '"+1"', '"1.0"', '"2"', '"0"'];

    it.each(ACCEPTED)('PUT con If-Match %j se acepta', async (value) => {
      const res = await api.update('hola', hola(), value);
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe(1);
    });

    it.each(REJECTED)('PUT con If-Match %j responde 412 con la revisión actual y su ETag', async (value) => {
      const res = await api.update('hola', { ...hola(), name: 'Cambiado' }, value);
      expect(res.status).toBe(412);
      expect(res.body).toEqual({ message: expect.any(String), error: 'revision_mismatch', currentRevision: 1 });
      expect(res.headers.etag).toBe('"1"');
      expect((await api.get('hola').expect(200)).body.name).toBe('Hola');
    });

    it('PUT con dos cabeceras If-Match las trata como una lista', async () => {
      const body = JSON.stringify(hola());
      const headers = ['Host: localhost', 'Content-Type: application/json'];
      const stale = await wireRequest(testApp.port, wireText('PUT', '/flows/hola', [...headers, 'If-Match: "9"', 'If-Match: "8"'], body));
      expect(stale.status).toBe(412);
      const current = await wireRequest(testApp.port, wireText('PUT', '/flows/hola', [...headers, 'If-Match: "9"', 'If-Match: "1"'], body));
      expect(current.status).toBe(200);
    });

    it.each(REJECTED.filter((value) => value !== ''))('publicar y borrar con If-Match %j responden 412 y no hacen nada', async (value) => {
      const publish = await api.publish('hola', value);
      expect(publish.status).toBe(412);
      expect(publish.body.currentRevision).toBe(1);
      const remove = await api.remove('hola', value);
      expect(remove.status).toBe(412);
      expect((await api.versions('hola').expect(200)).body.total).toBe(0);
      await api.get('hola').expect(200);
    });

    it('publicar y borrar con If-Match * o con la revisión actual funcionan', async () => {
      expect((await api.publish('hola', '*')).status).toBe(201);
      expect((await api.publish('hola', '"1"')).status).toBe(200);
      expect((await api.remove('hola', '"1"')).status).toBe(204);
    });
  });

  describe('orden de comprobación al actualizar', () => {
    const put = (id: string, body: string | object, ifMatch?: string, headers: Record<string, string> = {}) =>
      raw('PUT', `/flows/${id}`, typeof body === 'string' ? body : JSON.stringify(body), { ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }), ...headers });

    const withLiteral = (extra: object) => {
      const flow = leads();
      flow.nodes[HTTP_NODE].request.headers.Authorization = 'Bearer abc123';
      return { ...flow, ...extra };
    };

    beforeEach(async () => {
      await api.create(hola()).expect(201);
    });

    it('JSON roto antes que flujo inexistente, aunque no haya If-Match', async () => {
      expectError(await put('nada', '{'), 400, 'invalid_json');
      expectError(await raw('PUT', '/flows/nada', undefined, { 'content-type': 'application/json', 'if-match': '*' }), 400, 'invalid_json');
    });

    it('tipo de contenido antes que flujo inexistente, y tamaño antes que tipo de contenido', async () => {
      expectError(await put('nada', JSON.stringify(hola()), '*', { 'content-type': 'text/plain' }), 415, 'unsupported_media_type');
      const big = ' '.repeat(1_048_577);
      expectError(await put('nada', big, '*', { 'content-type': 'text/plain' }), 413, 'payload_too_large');
    });

    it('flujo inexistente antes que la falta de If-Match, con un id mal formado o bien formado', async () => {
      expectError(await put('nada', hola()), 404, 'flow_not_found');
      expectError(await put('Nada', hola(), '*'), 404, 'flow_not_found');
    });

    it('428 antes que flujo inválido y 412 antes que flujo inválido', async () => {
      expectError(await put('hola', { ...hola(), color: 'rojo' }), 428, 'precondition_required');
      const stale = await put('hola', { ...hola(), color: 'rojo' }, '"9"');
      expectError(stale, 412, 'revision_mismatch');
      expect(stale.json.currentRevision).toBe(1);
    });

    it('flujo inválido, después credencial escrita y al final id distinto', async () => {
      expectError(await put('hola', { ...withLiteral({ id: 'otro' }), color: 'rojo' }, '"1"'), 400, 'invalid_flow');
      expectError(await put('hola', withLiteral({ id: 'otro' }), '"1"'), 400, 'literal_credential');
      expectError(await put('hola', { ...hola(), id: 'otro' }, '"1"'), 400, 'flow_id_mismatch');
    });

    it('un cuerpo que no es un objeto es un flujo inválido, no un error de la petición', async () => {
      for (const body of ['null', '[]', '"hola"', '1', 'true']) expectError(await put('hola', body, '*'), 400, 'invalid_flow');
    });

    it('nada de lo anterior cambió el borrador', async () => {
      const res = (await api.get('hola').expect(200)).body;
      expect(res.revision).toBe(1);
      expect(res.name).toBe('Hola');
    });
  });

  describe('indicador de cambios sin publicar', () => {
    it('vale lo que dice la spec: cambia con cada edición y vuelve a false al recuperar el contenido de la última versión', async () => {
      const state = async () => {
        const one = (await api.get('hola').expect(200)).body;
        const listed = (await api.list().expect(200)).body.items[0];
        expect(listed.unpublishedChanges).toBe(one.unpublishedChanges);
        expect(listed.revision).toBe(one.revision);
        return [one.unpublishedChanges, one.revision, one.latestVersion];
      };
      expect((await api.create(hola()).expect(201)).body.unpublishedChanges).toBe(true);
      expect(await state()).toEqual([true, 1, null]);
      await api.publish('hola').expect(201);
      expect(await state()).toEqual([false, 1, 1]);
      const edited = (await api.update('hola', { ...hola(), name: 'Otro' }, '"1"').expect(200)).body;
      expect([edited.unpublishedChanges, edited.revision]).toEqual([true, 2]);
      const reverted = (await api.update('hola', hola(), '"2"').expect(200)).body;
      expect([reverted.unpublishedChanges, reverted.revision, reverted.latestVersion]).toEqual([false, 3, 1]);
      expect(await state()).toEqual([false, 3, 1]);
      const again = (await api.update('hola', { ...hola(), description: 'x' }, '*').expect(200)).body;
      expect(again.unpublishedChanges).toBe(true);
      expect((await api.publish('hola').expect(201)).body.version).toBe(2);
      expect(await state()).toEqual([false, 4, 2]);
    });

    it('publicar no toca revision ni updatedAt, y un borrador escrito a mano se corrige al editarlo: el indicador se recalcula contra la última versión', async () => {
      const created = (await api.create(hola()).expect(201)).body;
      const published = await api.publish('hola').expect(201);
      const after = (await api.get('hola').expect(200)).body;
      expect([after.revision, after.updatedAt]).toEqual([created.revision, created.updatedAt]);
      expect(published.body.publishedAt >= created.createdAt).toBe(true);
      await writeDraftDirectly(prisma, 'hola', JSON.stringify({ ...hola(), name: 'A mano' }));
      const edited = (await api.update('hola', hola(), '"1"').expect(200)).body;
      expect(edited.unpublishedChanges).toBe(false);
    });
  });

  describe('ciclo de vida', () => {
    it('un flujo borrado desaparece de los listados con y sin published y su id sigue reservado', async () => {
      await api.create(hola()).expect(201);
      await api.publish('hola').expect(201);
      await api.create({ ...hola(), id: 'otro' }).expect(201);
      await api.remove('hola').expect(204);
      expect((await api.list('?published=true').expect(200)).body).toMatchObject({ items: [], total: 0 });
      expect((await api.list('?published=false').expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual(['otro']);
      expect((await api.list().expect(200)).body.total).toBe(1);
      for (let attempt = 0; attempt < 2; attempt++) expectError(await raw('POST', '/flows', JSON.stringify(hola())), 409, 'flow_id_reserved');
      expectError(await raw('POST', '/flows', JSON.stringify({ ...hola(), color: 1 })), 400, 'invalid_flow');
      expect(await prisma.flowVersion.count({ where: { flowId: 'hola' } })).toBe(1);
    });

    it('borrar no publica ni toca las versiones, y la numeración no se reinicia en la base', async () => {
      await api.create(hola()).expect(201);
      await api.publish('hola').expect(201);
      await api.update('hola', { ...hola(), name: 'V2' }, '"1"').expect(200);
      await api.publish('hola').expect(201);
      const before = await prisma.flowVersion.findMany({ where: { flowId: 'hola' }, orderBy: { version: 'asc' } });
      await api.remove('hola').expect(204);
      const after = await prisma.flowVersion.findMany({ where: { flowId: 'hola' }, orderBy: { version: 'asc' } });
      expect(after).toEqual(before);
      expect(after.map((row) => row.version)).toEqual([1, 2]);
    });
  });

  describe('números que JSON no puede representar', () => {
    const setFlow = (value: string, extra = '') =>
      `{"specVersion":"0.1","id":"numeros",${extra}"name":"N","variables":[{"name":"v","type":"number"}],"start":"s","nodes":[{"id":"s","type":"set","assignments":[{"variable":"v","value":${value}}],"next":"fin"},{"id":"fin","type":"end"}]}`;

    it.each(['1e400', '-1e400', '1E999'])('el valor %s de una asignación se guarda como null: lo validado es lo guardado', async (value) => {
      const res = await api.create(setFlow(value)).expect(201);
      expect(res.body.flow.nodes[0].assignments[0].value).toBeNull();
      const read = await api.get('numeros').expect(200);
      expect(read.body.flow.nodes[0].assignments[0].value).toBeNull();
      expect(read.text).toContain('"value":null');
    });

    it('1e400 donde la forma exige un entero deja un null inválido, no un 500', async () => {
      const res = await api.create(setFlow('1', '"settings":{"typingDelayMs":1e400},')).expect(400);
      expect(res.body.error).toBe('invalid_flow');
      expect(res.body.issues).toEqual([{ layer: 'shape', path: '/settings/typingDelayMs', message: 'debe ser de tipo integer' }]);
    });
  });

  describe('forma de todos los errores', () => {
    const MARKER = 'ECO-QA5-no-debe-volver';

    /** Un flujo cuyo texto lleva el marcador en el nombre y en una cabecera que no es de credenciales. */
    const marked = () => {
      const flow = leads();
      flow.name = MARKER;
      flow.nodes[HTTP_NODE].request.headers['X-Eco'] = MARKER;
      return flow;
    };

    it('cada error lleva exactamente message, error y los campos propios, y ninguno repite el texto del flujo', async () => {
      await api.create(marked()).expect(201);
      await api.create({ ...hola(), id: 'borrado' }).expect(201);
      await api.remove('borrado').expect(204);
      const literal = marked();
      literal.id = 'con-token';
      literal.nodes[HTTP_NODE].request.headers.Authorization = `Bearer ${MARKER}`;
      const json = JSON.stringify(marked());

      const cases: [string, Awaited<ReturnType<typeof raw>>, number, string][] = [
        ['id repetido', await raw('POST', '/flows', json), 409, 'flow_already_exists'],
        ['id reservado', await raw('POST', '/flows', JSON.stringify({ ...marked(), id: 'borrado' })), 409, 'flow_id_reserved'],
        ['sin If-Match', await raw('PUT', '/flows/captacion-leads', json), 428, 'precondition_required'],
        ['revisión desfasada', await raw('PUT', '/flows/captacion-leads', json, { 'if-match': '"9"' }), 412, 'revision_mismatch'],
        ['otro id', await raw('PUT', '/flows/captacion-leads', JSON.stringify({ ...marked(), id: 'otro' }), { 'if-match': '*' }), 400, 'flow_id_mismatch'],
        ['credencial escrita al crear', await raw('POST', '/flows', JSON.stringify(literal)), 400, 'literal_credential'],
        ['credencial escrita al actualizar', await raw('PUT', '/flows/captacion-leads', JSON.stringify({ ...literal, id: 'captacion-leads' }), { 'if-match': '*' }), 400, 'literal_credential'],
        ['texto plano', await raw('POST', '/flows', json, { 'content-type': 'text/plain' }), 415, 'unsupported_media_type'],
        ['JSON roto', await raw('POST', '/flows', `{"name":"${MARKER}`), 400, 'invalid_json'],
        ['cuerpo enorme', await raw('POST', '/flows', `{"name":"${MARKER}"${' '.repeat(1_048_577)}}`), 413, 'payload_too_large'],
        ['consulta mala', await raw('GET', `/flows?limit=${MARKER}`), 400, 'invalid_query'],
        ['id inexistente', await raw('GET', `/flows/${MARKER.toLowerCase()}`), 404, 'flow_not_found'],
        ['versión inexistente', await raw('GET', '/flows/captacion-leads/versions/7'), 404, 'version_not_found'],
        ['ruta desconocida', await raw('GET', `/${MARKER}`), 404, 'not_found'],
        ['método desconocido', await raw('PATCH', '/flows/captacion-leads', json), 404, 'not_found'],
        ['Host ajeno', await raw('GET', '/flows', undefined, { host: 'evil.example' }), 403, 'forbidden_host'],
        ['Origin', await raw('POST', '/flows', json, { origin: 'https://evil.example' }), 403, 'forbidden_origin'],
      ];
      for (const [name, res, status, error] of cases) {
        expectError(res, status, error);
        expect(res.text, name).not.toContain(MARKER);
        expect(res.headers['content-type'], name).toMatch(/^application\/json/);
      }
    });
  });

  describe('credenciales escritas en el flujo', () => {
    const SECRET = 'TOPSECRET-qa5-9f8e7d';

    const withHeaders = (id: string, headers: Record<string, unknown>) => {
      const flow = leads();
      flow.id = id;
      flow.nodes[HTTP_NODE].request.headers = headers;
      return flow;
    };

    it.each([
      'Authorization',
      'authorization',
      'AUTHORIZATION',
      'Proxy-Authorization',
      'Cookie',
      'X-Api-Key',
      'x-api-key',
      'Api-Key',
      'X-Auth-Token',
      'x-AUTH-token',
    ])('la cabecera %s con un valor escrito se rechaza al crear, actualizar y publicar sin repetir el valor', async (name) => {
      const created = await api.create(withHeaders('con-token', { [name]: `Bearer ${SECRET}` }));
      expectApiError(created, 400, 'literal_credential');
      expect(created.text).not.toContain(SECRET);
      expect(created.body.warnings).toEqual([
        expect.objectContaining({ code: 'credential_header_literal', path: `/nodes/${HTTP_NODE}/request/headers/${name}`, nodeId: 'enviar-crm' }),
      ]);
      expect(await prisma.flow.count()).toBe(0);

      await api.create(withHeaders('limpio', { 'Content-Type': 'application/json' })).expect(201);
      const updated = await api.update('limpio', withHeaders('limpio', { [name]: SECRET }), '"1"');
      expectApiError(updated, 400, 'literal_credential');
      expect(updated.text).not.toContain(SECRET);
      expect((await api.get('limpio').expect(200)).body.revision).toBe(1);

      await writeDraftDirectly(prisma, 'limpio', JSON.stringify(withHeaders('limpio', { [name]: SECRET })));
      const published = await api.publish('limpio');
      expectApiError(published, 400, 'literal_credential');
      expect(published.text).not.toContain(SECRET);
      expect((await api.versions('limpio').expect(200)).body.total).toBe(0);
    });

    it('un valor vacío o de espacios también es una credencial escrita', async () => {
      for (const value of ['', '   ']) expectApiError(await api.create(withHeaders('vacio', { Authorization: value })), 400, 'literal_credential');
    });

    it('una referencia a un secreto, un texto con variable y las demás cabeceras se guardan', async () => {
      await api.create(withHeaders('con-secreto', { Authorization: { secret: 'CRM_TOKEN' }, 'Content-Type': 'text/plain' })).expect(201);
      const withMarker = await api.create(withHeaders('con-variable', { Authorization: 'Bearer {{segmento}}' })).expect(201);
      expect(withMarker.body.warnings).toEqual([expect.objectContaining({ code: 'credential_header_not_secret' })]);
    });

    it('validar no rechaza y tampoco repite el valor en el aviso', async () => {
      const res = await api.validate(withHeaders('v', { Authorization: `Bearer ${SECRET}` })).expect(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.warnings).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });
  });
});
