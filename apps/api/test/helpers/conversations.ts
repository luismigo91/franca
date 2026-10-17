import type { Server } from 'node:http';
import request, { type Response, type Test } from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { client, type ApiClient } from './client.js';
import { createConversationsTestApp, type ConversationsTestApp, type ConversationsTestAppOptions } from './conversations-app.js';
import { createTestPrisma } from './database.js';
import { faq, hola, leads } from './examples.js';

type Body = object | string | undefined;

function withBody(test: Test, body: Body): Test {
  if (body === undefined) return test;
  return test.set('Content-Type', 'application/json').send(typeof body === 'string' ? body : JSON.stringify(body));
}

/** Cliente de las siete rutas de conversaciones y contactos. Un cuerpo `string` se envía tal cual. */
export function conversationsClient(server: Server) {
  const ifMatch = (test: Test, value: string | undefined) => (value === undefined ? test : test.set('If-Match', value));
  return {
    create: (body: Body) => withBody(request(server).post('/conversations'), body),
    list: (query = '') => request(server).get(`/conversations${query}`),
    get: (id: string) => request(server).get(`/conversations/${id}`),
    send: (id: string, body: Body, match?: string) => ifMatch(withBody(request(server).post(`/conversations/${id}/inputs`), body), match),
    transcript: (id: string, query = '') => request(server).get(`/conversations/${id}/transcript${query}`),
    remove: (id: string) => request(server).delete(`/conversations/${id}`),
    removeContact: (contactId: string) => request(server).delete(`/contacts/${contactId}`),
  };
}

export type ConversationsClient = ReturnType<typeof conversationsClient>;

/** Vacía las tablas de las conversaciones y de los flujos. `resetDatabase` sigue valiendo: nada referencia a `flows`. */
export async function resetConversations(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE conversation_entries, conversations, contact_values, contacts, flow_versions, flows`;
}

/** El contenido de todas las filas de las cuatro tablas de conversaciones, como un solo texto (para buscar datos personales). */
export async function dumpConversationTables(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRaw<{ row: string }[]>`
    SELECT row_to_json(t)::text AS row FROM conversations t
    UNION ALL SELECT row_to_json(t)::text FROM conversation_entries t
    UNION ALL SELECT row_to_json(t)::text FROM contacts t
    UNION ALL SELECT row_to_json(t)::text FROM contact_values t`;
  return rows.map((row) => row.row).join('\n');
}

// ---- Flujos de los escenarios (los de `conversations-api`/spec.md) ----

/** `pregunta`: `sessionTimeoutMinutes` 30, nombre de sesión y email de contacto. */
export const pregunta = (): any => ({
  specVersion: '0.1',
  id: 'pregunta',
  name: 'Pregunta',
  settings: { sessionTimeoutMinutes: 30 },
  variables: [
    { name: 'nombre', type: 'string' },
    { name: 'email', type: 'email', scope: 'contact', pii: true },
  ],
  start: 'p',
  nodes: [
    { id: 'p', type: 'input', inputType: 'text', variable: 'nombre', prompt: [{ kind: 'text', text: '¿Nombre?' }], next: 'fin' },
    { id: 'fin', type: 'end', outcome: 'ok', content: [{ kind: 'text', text: 'Adiós, {{email}}.' }] },
  ],
});

export const saludoContacto = (): any => ({
  specVersion: '0.1',
  id: 'saludo-contacto',
  name: 'Saludo',
  variables: [{ name: 'email', type: 'email', scope: 'contact', pii: true }],
  start: 'fin',
  nodes: [{ id: 'fin', type: 'end', content: [{ kind: 'text', text: 'Hola, {{email}}.' }] }],
});

export const olvido = (): any => ({
  specVersion: '0.1',
  id: 'olvido',
  name: 'Olvido',
  variables: [{ name: 'email', type: 'email', scope: 'contact', pii: true }],
  start: 'borrar',
  nodes: [
    { id: 'borrar', type: 'set', assignments: [{ variable: 'email', value: null }], next: 'fin' },
    { id: 'fin', type: 'end' },
  ],
});

export const dobleLlm = (): any => ({
  specVersion: '0.1',
  id: 'doble-llm',
  name: 'Doble llm',
  start: 'a',
  nodes: [
    { id: 'a', type: 'llm', provider: 'principal', goal: 'Saluda.', next: 'b', onExhausted: 'fin' },
    { id: 'b', type: 'llm', provider: 'principal', goal: 'Despídete.', next: 'fin', onExhausted: 'fin' },
    { id: 'fin', type: 'end', outcome: 'fin' },
  ],
});

/** `saludo-contacto` con `id` `saludo-proto` y su variable de contacto y su marcador renombrados a `__proto__`. */
export const saludoProto = (): any => {
  const flow = JSON.parse(JSON.stringify(saludoContacto()).replaceAll('"name":"email"', '"name":"__proto__"').replaceAll('{{email}}', '{{__proto__}}'));
  flow.id = 'saludo-proto';
  return flow;
};

/** La variable de contacto `__proto__` y un `set` `fijar` que le asigna `"x@example.com"` antes de un `end`. */
export const fijarProto = (): any => ({
  specVersion: '0.1',
  id: 'fijar-proto',
  name: 'Fijar proto',
  variables: [{ name: '__proto__', type: 'email', scope: 'contact', pii: true }],
  start: 'fijar',
  nodes: [
    { id: 'fijar', type: 'set', assignments: [{ variable: '__proto__', value: 'x@example.com' }], next: 'fin' },
    { id: 'fin', type: 'end' },
  ],
});

export { faq, hola, leads };

// ---- Contexto de un fichero de e2e ----

export interface ConversationsContext {
  testApp: ConversationsTestApp;
  prisma: PrismaClient;
  /** Cliente de la API de flujos. */
  flows: ApiClient;
  conv: ConversationsClient;
  /** Crea y publica un flujo (201 y 201); devuelve su `id`. */
  publish(flow: { id: string }): Promise<string>;
  /** Publica otra versión del flujo con la definición dada (`PUT` con `If-Match: *` y publicar). */
  republish(flow: { id: string }): Promise<void>;
  /** `POST /conversations` esperando 201: devuelve el cuerpo. */
  start(flowId: string, extra?: Record<string, unknown>): Promise<{ id: string; body: any }>;
  /** `POST …/inputs` esperando 200: devuelve el cuerpo. */
  say(id: string, input: unknown, ifMatch?: string): Promise<any>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Arranca la app de test, la base y los clientes. Úsalo en `beforeAll`; `reset()` en `beforeEach` y `close()` en `afterAll`. */
export async function startConversationsContext(options: ConversationsTestAppOptions = {}): Promise<ConversationsContext> {
  const testApp = await createConversationsTestApp(options);
  const prisma = createTestPrisma();
  const flows = client(testApp.server);
  const conv = conversationsClient(testApp.server);
  const context: ConversationsContext = {
    testApp,
    prisma,
    flows,
    conv,
    async publish(flow) {
      await flows.create(flow).expect(201);
      await flows.publish(flow.id).expect(201);
      return flow.id;
    },
    async republish(flow) {
      await flows.update(flow.id, flow, '*').expect(200);
      await flows.publish(flow.id).expect(201);
    },
    async start(flowId, extra = {}) {
      const res = await conv.create({ flowId, ...extra }).expect(201);
      return { id: res.body.conversation.id as string, body: res.body };
    },
    async say(id, input, ifMatch) {
      const res: Response = await conv.send(id, { input }, ifMatch).expect(200);
      return res.body;
    },
    async reset() {
      await resetConversations(prisma);
      testApp.llm.reset();
      testApp.clock.reset();
    },
    async close() {
      await testApp.close();
      await prisma.$disconnect();
    },
  };
  return context;
}
