import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase, writeDraftDirectly } from './helpers/database.js';
import { HTTP_NODE, leads } from './helpers/examples.js';

const MESSAGE = expect.any(String);
const AUTH_PATH = '/nodes/6/request/headers/Authorization';

/** Un flujo válido con `count` nodos `http` encadenados cuya url depende de una variable (un aviso cada uno). */
function chainOfHttpNodes(count: number, lastAuthorization?: string): any {
  const nodes: any[] = Array.from({ length: count }, (_, i) => ({
    id: `llamada-${i}`,
    type: 'http',
    request: {
      method: 'GET',
      url: 'https://{{segmento}}.example.com/x',
      ...(i === count - 1 && lastAuthorization ? { headers: { Authorization: lastAuthorization } } : {}),
    },
    next: i === count - 1 ? 'fin' : `llamada-${i + 1}`,
    onError: 'fin',
  }));
  nodes.push({ id: 'fin', type: 'end' });
  return {
    specVersion: '0.1',
    id: 'cadena',
    name: 'Cadena',
    variables: [{ name: 'segmento', type: 'string' }],
    start: 'llamada-0',
    nodes,
  };
}

/** `captacion-leads` con una cabecera de `enviar-crm` cambiada. */
function leadsWithHeaders(headers: Record<string, unknown>): any {
  const flow = leads();
  flow.nodes[HTTP_NODE].request.headers = headers;
  return flow;
}

describe('credenciales y avisos en la API (e2e)', () => {
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

  describe('Credenciales escritas en el flujo', () => {
    it('Token pegado al crear', async () => {
      const res = await api.create(leadsWithHeaders({ Authorization: 'Bearer abc123', 'Content-Type': 'application/json' })).expect(400);
      expect(Object.keys(res.body)).toEqual(['message', 'error', 'warnings']);
      expect(res.body).toEqual({
        message: MESSAGE,
        error: 'literal_credential',
        warnings: [expect.objectContaining({ code: 'credential_header_literal', path: AUTH_PATH, nodeId: 'enviar-crm' })],
      });
      expect(res.text).not.toContain('abc123');
      await api.get('captacion-leads').expect(404);
    });

    it('Token pegado al actualizar', async () => {
      await api.create(leads()).expect(201);
      const next = leads();
      next.nodes[HTTP_NODE].request.headers['X-Api-Key'] = 'k-123';
      const res = await api.update('captacion-leads', next, '"1"').expect(400);
      expect(res.body.error).toBe('literal_credential');
      expect(res.text).not.toContain('k-123');
      const stored = (await api.get('captacion-leads').expect(200)).body;
      expect(stored.revision).toBe(1);
      expect(stored.flow).toEqual(leads());
    });

    it('Publicar un borrador con un token pegado', async () => {
      await api.create(leads()).expect(201);
      await writeDraftDirectly(prisma, 'captacion-leads', JSON.stringify(leadsWithHeaders({ Authorization: 'Bearer abc123' })));
      const res = await api.publish('captacion-leads').expect(400);
      expect(res.body.error).toBe('literal_credential');
      expect(res.text).not.toContain('abc123');
      expect((await api.versions('captacion-leads').expect(200)).body.total).toBe(0);
    });

    it('Credencial escrita después del aviso 100', async () => {
      const res = await api.create(chainOfHttpNodes(150, 'Bearer abc123')).expect(400);
      expect(res.body.error).toBe('literal_credential');
      expect(res.body.warnings).toEqual([
        expect.objectContaining({ code: 'credential_header_literal', path: '/nodes/149/request/headers/Authorization', nodeId: 'llamada-149' }),
      ]);
      expect(res.text).not.toContain('abc123');
    });

    it('Validar no rechaza', async () => {
      const res = await api.validate(leadsWithHeaders({ Authorization: 'Bearer abc123' })).expect(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.warnings).toEqual([expect.objectContaining({ code: 'credential_header_literal', path: AUTH_PATH })]);
    });

    it('Inválido y con una credencial escrita', async () => {
      const flow = leadsWithHeaders({ Authorization: 'Bearer abc123' });
      flow.nodes[0].color = 'rojo';
      const res = await api.create(flow).expect(400);
      expect(res.body.error).toBe('invalid_flow');
    });

    it('una credencial con marcadores se guarda con aviso y no se rechaza', async () => {
      const res = await api.create(leadsWithHeaders({ Authorization: 'Bearer {{segmento}}' })).expect(201);
      expect(res.body.warnings.map((w: { code: string }) => w.code)).toEqual(['credential_header_not_secret']);
    });

    it('la heurística se esquiva con un marcador, otra cabecera o la query de la url (límite documentado)', async () => {
      const flow = leadsWithHeaders({ Authorization: '{{segmento}}abc123', 'X-Custom-Token': 'abc123' });
      flow.nodes[HTTP_NODE].request.url = 'https://crm.example.com/api/leads?token=abc123';
      await api.create(flow).expect(201);
    });

    it('antes de los 409: un id repetido con una credencial escrita responde literal_credential', async () => {
      await api.create(leads()).expect(201);
      const res = await api.create(leadsWithHeaders({ Authorization: 'Bearer abc123' })).expect(400);
      expect(res.body.error).toBe('literal_credential');
    });
  });

  describe('Avisos en las respuestas', () => {
    it('Muchos avisos al validar', async () => {
      const res = await api.validate(chainOfHttpNodes(150)).expect(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.warnings).toHaveLength(101);
      expect(res.body.warnings[100]).toEqual({ code: 'too_many_warnings', path: '', message: 'hay más avisos: solo se muestran los 100 primeros' });
    });

    it('el recurso flujo y el recurso versión también recortan los avisos', async () => {
      const created = await api.create(chainOfHttpNodes(150)).expect(201);
      expect(created.body.warnings).toHaveLength(101);
      expect((await api.get('cadena').expect(200)).body.warnings).toHaveLength(101);
      const published = await api.publish('cadena').expect(201);
      expect(published.body.warnings).toHaveLength(101);
      expect((await api.version('cadena', 1).expect(200)).body.warnings[100].code).toBe('too_many_warnings');
    });

    it('un flujo inválido con avisos recortados no pierde el recorte en invalid_flow', async () => {
      const flow = chainOfHttpNodes(150);
      flow.start = 'no-existe';
      const res = await api.create(flow).expect(400);
      expect(res.body.error).toBe('invalid_flow');
      expect(res.body.warnings).toHaveLength(101);
    });
  });
});
