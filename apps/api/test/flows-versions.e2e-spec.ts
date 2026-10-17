import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase, writeDraftDirectly } from './helpers/database.js';
import { hola, leads } from './helpers/examples.js';

const MESSAGE = expect.any(String);

describe('versiones y borrado de flujos (e2e)', () => {
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

  /** Cambia el nombre del flujo (`revision` + 1 si el texto cambia). */
  async function rename(base: () => any, name: string): Promise<void> {
    const flow = base();
    flow.name = name;
    const current = (await api.get(flow.id).expect(200)).body.revision;
    await api.update(flow.id, flow, `"${current}"`).expect(200);
  }

  describe('Publicar una versión', () => {
    it('Primera versión', async () => {
      await api.create(leads()).expect(201);
      const res = await api.publish('captacion-leads').expect(201);
      expect(res.headers.location).toBe('/flows/captacion-leads/versions/1');
      expect(res.body).toEqual({
        flowId: 'captacion-leads',
        version: 1,
        name: 'Captación de leads',
        publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        flow: leads(),
        warnings: [],
      });
      expect(Object.keys(res.body)).toEqual(['flowId', 'version', 'name', 'publishedAt', 'flow', 'warnings']);
      const draft = (await api.get('captacion-leads').expect(200)).body;
      expect(res.body.flow).toEqual(draft.flow);
      expect(draft.revision).toBe(1);
      expect(draft.updatedAt).toBe(draft.createdAt);
    });

    it('Segunda versión tras un cambio', async () => {
      await api.create(leads()).expect(201);
      await api.publish('captacion-leads').expect(201);
      await rename(leads, 'Leads v2');
      const res = await api.publish('captacion-leads').expect(201);
      expect(res.body).toMatchObject({ version: 2, name: 'Leads v2' });
      expect(res.headers.location).toBe('/flows/captacion-leads/versions/2');
    });

    it('Publicar un flujo inexistente', async () => {
      const res = await api.publish('no-existe').expect(404);
      expect(res.body).toEqual({ message: MESSAGE, error: 'flow_not_found' });
    });
  });

  describe('Orden de comprobación al publicar', () => {
    it('Desfasado e inválido al publicar', async () => {
      await api.create(hola()).expect(201);
      await rename(hola, 'Hola 2');
      await writeDraftDirectly(prisma, 'hola', JSON.stringify({ ...hola(), name: 'Hola 2', start: 'no-existe' }));
      const res = await api.publish('hola', '"1"').expect(412);
      expect(res.body).toEqual({ message: MESSAGE, error: 'revision_mismatch', currentRevision: 2 });
      expect(res.headers.etag).toBe('"2"');
      expect((await api.versions('hola').expect(200)).body.total).toBe(0);
    });
  });

  describe('Publicar sin cambios', () => {
    it('Doble clic en publicar', async () => {
      await api.create(leads()).expect(201);
      const first = await api.publish('captacion-leads').expect(201);
      const second = await api.publish('captacion-leads').expect(200);
      expect(second.body.version).toBe(1);
      expect(second.body).toEqual(first.body);
      expect(second.headers.location).toBeUndefined();
      expect((await api.versions('captacion-leads').expect(200)).body.total).toBe(1);
    });

    it('Volver al contenido de una versión anterior', async () => {
      await api.create(hola()).expect(201);
      await api.publish('hola').expect(201);
      await rename(hola, 'Hola 2');
      await api.publish('hola').expect(201);
      await rename(hola, 'Hola');
      const res = await api.publish('hola').expect(201);
      expect(res.body.version).toBe(3);
    });
  });

  describe('Revisión esperada al publicar o borrar', () => {
    it('Publicar lo que se estaba viendo', async () => {
      await api.create(leads()).expect(201);
      await rename(leads, 'Leads v2');
      const res = await api.publish('captacion-leads', '"1"').expect(412);
      expect(res.body).toMatchObject({ error: 'revision_mismatch', currentRevision: 2 });
      expect((await api.versions('captacion-leads').expect(200)).body.total).toBe(0);
    });

    it('Borrar con la revisión al día', async () => {
      await api.create(leads()).expect(201);
      await rename(leads, 'Leads v2');
      const stale = await api.remove('captacion-leads', '"1"').expect(412);
      expect(stale.body.currentRevision).toBe(2);
      await api.get('captacion-leads').expect(200);
      const res = await api.remove('captacion-leads', '"2"').expect(204);
      expect(res.text).toBe('');
    });

    it('publicar y borrar aceptan * y una lista de etiquetas', async () => {
      await api.create(hola()).expect(201);
      await api.publish('hola', '*').expect(201);
      await rename(hola, 'Hola 2');
      await api.publish('hola', '"1", "2"').expect(201);
      await api.remove('hola', '*').expect(204);
    });
  });

  describe('Publicar revalida el borrador', () => {
    it('Borrador que dejó de ser válido', async () => {
      await api.create(hola()).expect(201);
      await writeDraftDirectly(prisma, 'hola', JSON.stringify({ ...hola(), start: 'no-existe' }));
      const res = await api.publish('hola').expect(400);
      expect(res.body.error).toBe('invalid_flow');
      expect(res.body.issues).toContainEqual({ layer: 'semantic', path: '/start', message: 'start apunta a un nodo inexistente: no-existe' });
      expect((await api.versions('hola').expect(200)).body.total).toBe(0);
    });
  });

  describe('Versiones inmutables', () => {
    it('Editar el borrador no cambia la versión', async () => {
      await api.create(leads()).expect(201);
      await api.publish('captacion-leads').expect(201);
      await rename(leads, 'Leads v2');
      const res = await api.version('captacion-leads', 1).expect(200);
      expect(res.body.name).toBe('Captación de leads');
      expect(res.body.flow.name).toBe('Captación de leads');
    });

    it('Sin rutas para cambiar una versión', async () => {
      await api.create(leads()).expect(201);
      const published = (await api.publish('captacion-leads').expect(201)).body;
      const put = await api.update('captacion-leads/versions/1', leads(), '*').expect(404);
      expect(put.body).toEqual({ message: MESSAGE, error: 'not_found' });
      const del = await api.remove('captacion-leads/versions/1').expect(404);
      expect(del.body).toEqual({ message: MESSAGE, error: 'not_found' });
      expect((await api.version('captacion-leads', 1).expect(200)).body).toEqual(published);
    });
  });

  describe('Leer versiones', () => {
    it('Historial', async () => {
      await api.create(hola()).expect(201);
      await api.publish('hola').expect(201);
      await rename(hola, 'Hola 2');
      await api.publish('hola').expect(201);
      await rename(hola, 'Hola 3');
      await api.publish('hola').expect(201);
      const res = await api.versions('hola', '?limit=2').expect(200);
      expect(res.body.items.map((item: { version: number }) => item.version)).toEqual([3, 2]);
      expect(res.body).toMatchObject({ total: 3, limit: 2, offset: 0 });
      expect(Object.keys(res.body.items[0])).toEqual(['flowId', 'version', 'name', 'publishedAt']);
      const rest = await api.versions('hola', '?limit=2&offset=2').expect(200);
      expect(rest.body.items.map((item: { version: number }) => item.version)).toEqual([1]);
    });

    it('Flujo sin versiones', async () => {
      await api.create(hola()).expect(201);
      const res = await api.versions('hola').expect(200);
      expect(res.body).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    });

    it('un flujo inexistente no tiene historial', async () => {
      const res = await api.versions('no-existe').expect(404);
      expect(res.body.error).toBe('flow_not_found');
    });
  });

  describe('Leer una versión', () => {
    it('Versión que no existe', async () => {
      await api.create(hola()).expect(201);
      await api.publish('hola').expect(201);
      for (const version of ['2', '0', '01', 'latest', '2147483648']) {
        const res = await api.version('hola', version).expect(404);
        expect(res.body, version).toEqual({ message: MESSAGE, error: 'version_not_found' });
      }
      const res = await api.version('no-existe', 1).expect(404);
      expect(res.body.error).toBe('flow_not_found');
    });
  });

  describe('Borrar un flujo', () => {
    async function holaWithTwoVersions(): Promise<void> {
      await api.create(hola()).expect(201);
      await api.publish('hola').expect(201);
      await rename(hola, 'Hola 2');
      await api.publish('hola').expect(201);
    }

    it('Borrar y volver a crear', async () => {
      await holaWithTwoVersions();
      await api.remove('hola').expect(204);
      expect((await api.get('hola').expect(404)).body.error).toBe('flow_not_found');
      expect((await api.version('hola', 1).expect(404)).body.error).toBe('flow_not_found');
      const recreated = await api.create(hola()).expect(409);
      expect(recreated.body).toEqual({ message: MESSAGE, error: 'flow_id_reserved' });
    });

    it('Las versiones se conservan', async () => {
      await holaWithTwoVersions();
      const before = [(await api.version('hola', 1).expect(200)).body, (await api.version('hola', 2).expect(200)).body];
      await api.remove('hola').expect(204);
      const rows = await prisma.flowVersion.findMany({ where: { flowId: 'hola' }, orderBy: { version: 'asc' } });
      expect(rows).toHaveLength(2);
      rows.forEach((row, index) => {
        expect(JSON.parse(row.nameJson)).toBe(before[index].name);
        expect(JSON.parse(row.definition)).toEqual(before[index].flow);
        expect(row.publishedAt.toISOString()).toBe(before[index].publishedAt);
      });
      const flow = await prisma.flow.findUnique({ where: { id: 'hola' } });
      expect(flow?.deletedAt).not.toBeNull();
    });

    it('Fuera del listado', async () => {
      await api.create(hola()).expect(201);
      await api.create(leads()).expect(201);
      await api.remove('hola').expect(204);
      const res = await api.list().expect(200);
      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['captacion-leads']);
      expect(res.body.total).toBe(1);
    });

    it('Borrar un flujo inexistente', async () => {
      const res = await api.remove('no-existe').expect(404);
      expect(res.body.error).toBe('flow_not_found');
    });

    it('Borrar dos veces', async () => {
      await api.create(hola()).expect(201);
      await api.remove('hola').expect(204);
      const responses = [await api.remove('hola'), await api.update('hola', hola(), '*'), await api.publish('hola')];
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('flow_not_found');
      }
    });

    it('la numeración de versiones y los datos del flujo borrado no se reutilizan', async () => {
      await holaWithTwoVersions();
      await api.remove('hola').expect(204);
      const list = await api.list('?published=true').expect(200);
      expect(list.body.total).toBe(0);
      expect(await prisma.flow.count()).toBe(1);
    });
  });
});
