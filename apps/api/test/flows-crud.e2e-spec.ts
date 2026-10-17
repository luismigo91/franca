import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { exampleText, faq, HTTP_NODE, hola, leads } from './helpers/examples.js';

const DEPTH_ISSUE = { layer: 'shape', path: '', message: 'el flujo supera la profundidad máxima de anidamiento (1000)' };
const MESSAGE = expect.any(String);

describe('CRUD de flujos (e2e)', () => {
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

  /** Crea y exige 201. */
  const created = async (flow: object | string) => (await api.create(flow).expect(201)).body;

  describe('Lo validado es lo guardado', () => {
    it('Número no representable en un default', async () => {
      const text = exampleText('captacion-leads').replace(
        /"variables":\s*\[/,
        '"variables": [{"name": "limite", "type": "number", "default": 1e400},',
      );
      expect(text).toContain('1e400');
      await api.create(text).expect(201);
      const res = await api.get('captacion-leads').expect(200);
      const variable = res.body.flow.variables.find((v: { name: string }) => v.name === 'limite');
      expect(variable).toEqual({ name: 'limite', type: 'number', default: null });
    });

    it('Número no representable donde se exige un número', async () => {
      const text = exampleText('captacion-leads').replace(/"position":\s*\{\s*"x":\s*0/, '"position": {"x": 1e400');
      expect(text).toContain('1e400');
      const res = await api.create(text).expect(400);
      expect(res.body.error).toBe('invalid_flow');
      expect(res.body.issues).toEqual([
        { layer: 'shape', path: '/nodes/0/position/x', nodeId: 'bienvenida', message: 'debe ser de tipo number' },
      ]);
    });

    it('Anidamiento extremo', async () => {
      const deep = `${'['.repeat(100_000)}1${']'.repeat(100_000)}`;
      const text = JSON.stringify(leads()).replace('"variables":[', `"variables":[{"name":"j","type":"json","default":${deep}},`);
      expect(text.length).toBeLessThan(1_048_576);
      const post = await api.create(text).expect(400);
      expect(post.body).toEqual({ message: MESSAGE, error: 'invalid_flow', issues: [DEPTH_ISSUE], warnings: [] });
      const validate = await api.validate(text).expect(200);
      expect(validate.body).toEqual({ valid: false, issues: [DEPTH_ISSUE], warnings: [] });
    });
  });

  describe('Orden de las propiedades', () => {
    const HEADERS = '"headers":{"X-B":"1","X-A":"2","Authorization":{"secret":"CRM_TOKEN"}}';

    it('Orden de las cabeceras', async () => {
      const flow = leads();
      flow.nodes[HTTP_NODE].request.headers = { 'X-B': '1', 'X-A': '2', Authorization: { secret: 'CRM_TOKEN' } };
      const creation = await api.create(flow).expect(201);
      const publication = await api.publish('captacion-leads').expect(201);
      const draft = await api.get('captacion-leads').expect(200);
      const version = await api.version('captacion-leads', 1).expect(200);
      for (const res of [creation, publication, draft, version]) expect(res.text).toContain(HEADERS);
      expect(JSON.stringify(version.body.flow)).toBe(JSON.stringify(flow));
    });

    it('Claves con nombre de Object en el body', async () => {
      const original = '"body":{"name":"{{nombre}}","email":"{{email}}","companySize":"{{tamano}}","segment":"{{segmento}}"}';
      expect(JSON.stringify(leads())).toContain(original);
      const text = JSON.stringify(leads()).replace(original, '"body":{"__proto__":"{{nombre}}","b":1,"2":2}');
      expect(text).toContain('"__proto__"');
      await api.create(text).expect(201);
      const res = await api.get('captacion-leads').expect(200);
      expect(res.text).toContain('"body":{"2":2,"__proto__":"{{nombre}}","b":1}');
    });
  });

  describe('Identidad de un flujo', () => {
    it('Identificador con mayúsculas', async () => {
      const res = await api.get('Captacion-Leads').expect(404);
      expect(res.body).toEqual({ message: MESSAGE, error: 'flow_not_found' });
    });

    it('Ruta específica antes que el parámetro', async () => {
      const flow = hola();
      flow.id = 'validate';
      await created(flow);
      const res = await api.validate(hola()).expect(200);
      expect(res.body).toEqual({ valid: true, issues: [], warnings: [] });
      const stored = await api.get('validate').expect(200);
      expect(stored.body.revision).toBe(1);
    });
  });

  describe('Crear un flujo', () => {
    it('Crear captacion-leads', async () => {
      const flow = leads();
      const res = await api.create(flow).expect(201);
      expect(res.headers.location).toBe('/flows/captacion-leads');
      expect(res.headers.etag).toBe('"1"');
      expect(res.body).toEqual({
        id: 'captacion-leads',
        name: 'Captación de leads',
        revision: 1,
        latestVersion: null,
        unpublishedChanges: true,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        updatedAt: res.body.createdAt,
        flow,
        warnings: [],
      });
      expect(Object.keys(res.body)).toEqual(['id', 'name', 'revision', 'latestVersion', 'unpublishedChanges', 'createdAt', 'updatedAt', 'flow', 'warnings']);
    });

    it('Flujo inválido', async () => {
      const flow = leads();
      flow.nodes[0].color = 'rojo';
      const res = await api.create(flow).expect(400);
      expect(res.body).toEqual({
        message: MESSAGE,
        error: 'invalid_flow',
        issues: [{ layer: 'shape', path: '/nodes/0', nodeId: 'bienvenida', message: "propiedad no permitida 'color'" }],
        warnings: [],
      });
      await api.get('captacion-leads').expect(404);
    });

    it('Se guarda con avisos', async () => {
      const flow = leads();
      flow.nodes[HTTP_NODE].request.headers.Authorization = 'Bearer {{segmento}}';
      const res = await api.create(flow).expect(201);
      expect(res.body.warnings).toEqual([
        expect.objectContaining({ code: 'credential_header_not_secret', path: '/nodes/6/request/headers/Authorization', nodeId: 'enviar-crm' }),
      ]);
    });
  });

  describe('Id en uso al crear', () => {
    it('Id repetido', async () => {
      await created(leads());
      const other = leads();
      other.name = 'Otro';
      const res = await api.create(other).expect(409);
      expect(res.body).toEqual({ message: MESSAGE, error: 'flow_already_exists' });
      const stored = await api.get('captacion-leads').expect(200);
      expect(stored.body.name).toBe('Captación de leads');
      expect(stored.body.revision).toBe(1);
    });

    it('Inválido e id repetido', async () => {
      await created(leads());
      const broken = leads();
      broken.nodes[0].color = 'rojo';
      const res = await api.create(broken).expect(400);
      expect(res.body.error).toBe('invalid_flow');
    });
  });

  describe('Recurso flujo', () => {
    it('Tras publicar', async () => {
      await created(leads());
      await api.publish('captacion-leads').expect(201);
      const res = await api.get('captacion-leads').expect(200);
      expect(res.body.latestVersion).toBe(1);
      expect(res.body.unpublishedChanges).toBe(false);
      expect(res.body.revision).toBe(1);
    });

    it('Cambios sin publicar', async () => {
      await created(leads());
      await api.publish('captacion-leads').expect(201);
      const next = leads();
      next.name = 'Leads v2';
      await api.update('captacion-leads', next, '"1"').expect(200);
      const res = await api.get('captacion-leads').expect(200);
      expect(res.body).toMatchObject({ name: 'Leads v2', revision: 2, latestVersion: 1, unpublishedChanges: true });
    });
  });

  describe('Obtener un flujo', () => {
    it('Leer un flujo', async () => {
      await created(leads());
      const next = leads();
      for (const name of ['Leads v2', 'Leads v3']) {
        next.name = name;
        const current = (await api.get('captacion-leads').expect(200)).body.revision;
        await api.update('captacion-leads', next, `"${current}"`).expect(200);
      }
      const res = await api.get('captacion-leads').expect(200);
      expect(res.headers.etag).toBe('"3"');
      expect(res.body.revision).toBe(3);
    });

    it('Lectura condicional ignorada', async () => {
      await created(leads());
      const first = await api.get('captacion-leads').expect(200);
      expect(first.headers.etag).toBe('"1"');
      await api.publish('captacion-leads').expect(201);
      const res = await api.get('captacion-leads').set('If-None-Match', '"1"').set('If-Modified-Since', 'Fri, 01 Jan 2100 00:00:00 GMT').expect(200);
      expect(res.body.latestVersion).toBe(1);
      expect(res.body.flow).toEqual(leads());
    });
  });

  describe('Listar flujos', () => {
    it('Sin flujos', async () => {
      const res = await api.list().expect(200);
      expect(res.body).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    });

    it('Orden y páginas', async () => {
      await created(hola());
      await created(leads());
      await created(faq());
      const first = await api.list('?limit=2').expect(200);
      expect(first.body.items.map((item: { id: string }) => item.id)).toEqual(['faq-ia', 'captacion-leads']);
      expect(first.body).toMatchObject({ total: 3, limit: 2, offset: 0 });
      const second = await api.list('?limit=2&offset=2').expect(200);
      expect(second.body.items.map((item: { id: string }) => item.id)).toEqual(['hola']);
      expect(second.body).toMatchObject({ total: 3, limit: 2, offset: 2 });
      expect(Object.keys(first.body.items[0])).toEqual(['id', 'name', 'revision', 'latestVersion', 'unpublishedChanges', 'createdAt', 'updatedAt']);
    });

    it('Actualizar sube un flujo al principio', async () => {
      await created(hola());
      await created(leads());
      await created(faq());
      await api.update('hola', { ...hola(), name: 'Hola 2' }, '"1"').expect(200);
      const res = await api.list().expect(200);
      expect(res.body.items[0].id).toBe('hola');
    });

    it('Solo publicados', async () => {
      await created(hola());
      await created(leads());
      await api.publish('captacion-leads').expect(201);
      const published = await api.list('?published=true').expect(200);
      expect(published.body.items.map((item: { id: string }) => item.id)).toEqual(['captacion-leads']);
      expect(published.body.total).toBe(1);
      const drafts = await api.list('?published=false').expect(200);
      expect(drafts.body.items.map((item: { id: string }) => item.id)).toEqual(['hola']);
      expect(drafts.body.total).toBe(1);
    });

    it('ordena por id con el código de carácter cuando coincide la fecha', async () => {
      await created(hola());
      await prisma.$executeRaw`UPDATE flows SET updated_at = '2026-10-17T10:00:00Z'`;
      for (const id of ['ab', 'a-c', 'a_b']) await created({ ...hola(), id });
      await prisma.$executeRaw`UPDATE flows SET updated_at = '2026-10-17T10:00:00Z'`;
      const res = await api.list().expect(200);
      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['a-c', 'a_b', 'ab', 'hola']);
    });
  });

  describe('Parámetros de listado', () => {
    it('Valores fuera de rango o mal escritos', async () => {
      for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=2.5', 'offset=-1', 'offset=2147483648', 'limit=1&limit=2', 'published=si']) {
        const res = await api.list(`?${query}`).expect(400);
        expect(res.body, query).toEqual({ message: MESSAGE, error: 'invalid_query' });
      }
    });

    it('Límites admitidos y parámetros desconocidos', async () => {
      for (const query of ['limit=1', 'limit=100', 'offset=2147483647', 'orden=nombre']) {
        await api.list(`?${query}`).expect(200);
      }
    });

    it('los listados de versiones aplican las mismas reglas', async () => {
      await created(hola());
      await api.versions('hola', '?limit=0').expect(400);
      await api.versions('hola', '?published=si').expect(400);
      await api.versions('hola', '?orden=x').expect(200);
    });
  });

  describe('Actualizar el borrador', () => {
    it('Cambiar el nombre', async () => {
      const first = await created(leads());
      const next = leads();
      next.name = 'Leads v2';
      const res = await api.update('captacion-leads', next, '"1"').expect(200);
      expect(res.headers.etag).toBe('"2"');
      expect(res.body).toMatchObject({ revision: 2, name: 'Leads v2' });
      expect(res.body.updatedAt > first.createdAt).toBe(true);
      expect(res.body.createdAt).toBe(first.createdAt);
      expect(res.body.flow.name).toBe('Leads v2');
    });

    it('Cambiar el id', async () => {
      await created(leads());
      const next = leads();
      next.id = 'captacion-leads-v2';
      const res = await api.update('captacion-leads', next, '"1"').expect(400);
      expect(res.body).toEqual({ message: MESSAGE, error: 'flow_id_mismatch' });
      expect((await api.get('captacion-leads').expect(200)).body.revision).toBe(1);
      await api.get('captacion-leads-v2').expect(404);
    });

    it('Actualizar un flujo inexistente', async () => {
      const res = await api.update('hola', hola(), '"1"').expect(404);
      expect(res.body.error).toBe('flow_not_found');
      await api.get('hola').expect(404);
    });

    it('Borrador inválido', async () => {
      await created(leads());
      const broken = leads();
      broken.nodes[0].color = 'rojo';
      const res = await api.update('captacion-leads', broken, '"1"').expect(400);
      expect(res.body).toMatchObject({ error: 'invalid_flow', warnings: [] });
      expect(res.body.issues).toEqual([{ layer: 'shape', path: '/nodes/0', nodeId: 'bienvenida', message: "propiedad no permitida 'color'" }]);
      const stored = (await api.get('captacion-leads').expect(200)).body;
      expect(stored.revision).toBe(1);
      expect(stored.flow).toEqual(leads());
    });

    it('un PUT con un ruta de id inválido responde flow_not_found', async () => {
      await api.update('Hola', hola(), '"1"').expect(404);
    });
  });

  describe('Revisión esperada al actualizar', () => {
    it('Sin If-Match', async () => {
      await created(leads());
      const res = await api.update('captacion-leads', leads()).expect(428);
      expect(res.body).toEqual({ message: MESSAGE, error: 'precondition_required' });
      expect((await api.get('captacion-leads').expect(200)).body.revision).toBe(1);
    });

    it('Revisión desfasada', async () => {
      await created(leads());
      const next = leads();
      next.name = 'Leads v2';
      await api.update('captacion-leads', next, '"1"').expect(200);
      next.name = 'Leads v3';
      const res = await api.update('captacion-leads', next, '"1"').expect(412);
      expect(res.body).toEqual({ message: MESSAGE, error: 'revision_mismatch', currentRevision: 2 });
      expect(res.headers.etag).toBe('"2"');
      expect((await api.get('captacion-leads').expect(200)).body.name).toBe('Leads v2');
    });

    it('Etiqueta débil o sin comillas', async () => {
      await created(leads());
      for (const match of ['W/"1"', '1']) {
        const res = await api.update('captacion-leads', leads(), match).expect(412);
        expect(res.body.error).toBe('revision_mismatch');
      }
    });

    it('Sobrescribir explícitamente', async () => {
      await created(leads());
      const next = leads();
      for (const name of ['Leads v2', 'Leads v3', 'Leads v4']) {
        next.name = name;
        await api.update('captacion-leads', next, '*').expect(200);
      }
      expect((await api.get('captacion-leads').expect(200)).body.revision).toBe(4);
      next.name = 'Importado';
      const res = await api.update('captacion-leads', next, '*').expect(200);
      expect(res.body.revision).toBe(5);
    });

    it('Lista de etiquetas', async () => {
      await created(leads());
      const next = leads();
      next.name = 'Leads v2';
      await api.update('captacion-leads', next, '"1"').expect(200);
      next.name = 'Leads v3';
      const res = await api.update('captacion-leads', next, '"1", "2"').expect(200);
      expect(res.body.revision).toBe(3);
    });
  });

  describe('Orden de comprobación al actualizar', () => {
    it('Desfasado e inválido', async () => {
      await created(leads());
      const next = leads();
      next.name = 'Leads v2';
      await api.update('captacion-leads', next, '"1"').expect(200);
      const broken = leads();
      broken.nodes[0].color = 'rojo';
      const res = await api.update('captacion-leads', broken, '"1"').expect(412);
      expect(res.body.error).toBe('revision_mismatch');
    });

    it('Inexistente y sin If-Match', async () => {
      const res = await api.update('hola', hola()).expect(404);
      expect(res.body.error).toBe('flow_not_found');
    });

    it('Inválido y con otro id', async () => {
      await created(leads());
      const broken = leads();
      broken.id = 'otro';
      broken.nodes[0].color = 'rojo';
      const res = await api.update('captacion-leads', broken, '"1"').expect(400);
      expect(res.body.error).toBe('invalid_flow');
    });
  });

  describe('Guardar sin cambios', () => {
    it('Autoguardado repetido', async () => {
      const first = await created(leads());
      const res = await api.update('captacion-leads', leads(), '"1"').expect(200);
      expect(res.body.revision).toBe(1);
      expect(res.headers.etag).toBe('"1"');
      expect(res.body.updatedAt).toBe(first.updatedAt);
    });

    it('Mismo contenido en otro orden', async () => {
      await created(hola());
      const reordered = { name: 'Hola', id: 'hola', specVersion: '0.1', start: 'fin', nodes: [{ type: 'end', id: 'fin' }] };
      const res = await api.update('hola', reordered, '"1"').expect(200);
      expect(res.body.revision).toBe(2);
      expect(Object.keys(res.body.flow)).toEqual(['name', 'id', 'specVersion', 'start', 'nodes']);
    });
  });

  describe('Validar sin guardar', () => {
    it('No guarda', async () => {
      await api.validate(hola()).expect(200);
      await api.get('hola').expect(404);
    });
  });
});
