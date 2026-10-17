import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { startCrm } from '../demo/crm.mjs';
import { demoHttpVariables } from '../demo/demo-config.mjs';
import { resetConversations } from './helpers/conversations.js';
import { createTestPrisma } from './helpers/database.js';
import { startApi, type RunningApi } from './helpers/process.js';
import { startWorld } from './helpers/http-world.js';

const copy = JSON.parse(readFileSync(new URL('../demo/captacion-leads-local.json', import.meta.url), 'utf8'));
const TOKEN_1 = 'Bearer t-1'; // gitleaks:allow
const TOKEN_2 = 'Bearer t-2'; // gitleaks:allow

interface Crm {
  port: number;
  lines: string[];
  close(): Promise<void>;
}

/** La copia de la demo con **solo** el puerto de la `url` cambiado (el CRM de los tests escucha en un puerto libre). */
const copyForPort = (port: number): any => {
  const flow = structuredClone(copy);
  flow.nodes[6].request.url = `http://crm.franca.test:${port}/api/leads`;
  return flow;
};

async function jsonRequest(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

describe('la cadena de la demo con el proceso real, el CRM simulado y la copia (e2e)', () => {
  const prisma = createTestPrisma();
  const apis: RunningApi[] = [];
  const crms: Crm[] = [];

  beforeAll(async () => {
    await resetConversations(prisma);
  });
  beforeEach(async () => {
    await resetConversations(prisma);
  });
  afterEach(async () => {
    await Promise.all(apis.splice(0).map((api) => api.stop()));
    await Promise.all(crms.splice(0).map((crm) => crm.close()));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function startCrmWith(token: string): Promise<Crm> {
    const lines: string[] = [];
    const running = await startCrm({ token, port: 0, log: (line: string) => lines.push(line) });
    const crm = { port: running.port, lines, close: () => running.close() };
    crms.push(crm);
    return crm;
  }

  /** La API real con la configuración de la demo, sin `NODE_EXTRA_CA_CERTS` ni red del test. */
  async function startDemoApi(token: string, crmPort: number): Promise<{ api: RunningApi; base: string }> {
    const api = startApi({ DATABASE_URL: inject('databaseUrl'), PORT: '0', ...demoHttpVariables({ token, crmPort }) });
    apis.push(api);
    const listening = await api.whenListening();
    if (!listening) throw new Error(`la API no arrancó:\n${api.output()}`);
    return { api, base: `http://${listening.host}:${listening.port}` };
  }

  /** Publica la copia y deja una conversación esperando en `pedir-tamano`. */
  async function leadReady(base: string, crmPort: number): Promise<string> {
    const flow = copyForPort(crmPort);
    if ((await jsonRequest(base, 'GET', `/flows/${flow.id}`)).status === 404) {
      expect((await jsonRequest(base, 'POST', '/flows', flow)).status).toBe(201);
      expect((await jsonRequest(base, 'POST', `/flows/${flow.id}/versions`)).status).toBe(201);
    }
    const created = await jsonRequest(base, 'POST', '/conversations', { flowId: flow.id });
    expect(created.status).toBe(201);
    const id = created.body.conversation.id as string;
    for (const text of ['Ana', 'ana@example.com']) {
      expect((await jsonRequest(base, 'POST', `/conversations/${id}/inputs`, { input: { text } })).status).toBe(200);
    }
    return id;
  }

  const choose = async (base: string, id: string, choice: string): Promise<any> => {
    const reply = await jsonRequest(base, 'POST', `/conversations/${id}/inputs`, { input: { choice } });
    expect(reply.status).toBe(200);
    return reply.body;
  };

  it('Leads consecutivos', async () => {
    const crm = await startCrmWith(TOKEN_1);
    const { base } = await startDemoApi(TOKEN_1, crm.port);
    const first = await choose(base, await leadReady(base, crm.port), 'grande');
    const second = await choose(base, await leadReady(base, crm.port), 'pequena');
    expect(first.conversation.outcome).toBe('lead-empresa');
    expect(second.conversation.outcome).toBe('lead-pyme');
    expect(first.events.filter((event: { type: string }) => event.type === 'http')).toEqual([{ type: 'http', nodeId: 'enviar-crm', attempts: 1, status: 201, error: null }]);
    expect(crm.lines.filter((line) => line.includes('POST'))).toEqual(['[crm simulado] POST /api/leads 201 L-1', '[crm simulado] POST /api/leads 201 L-2']);
  });

  it('Lead fuera del registro del CRM', async () => {
    const crm = await startCrmWith(TOKEN_1);
    const { api, base } = await startDemoApi(TOKEN_1, crm.port);
    const body = await choose(base, await leadReady(base, crm.port), 'grande');
    expect(body.conversation.outcome).toBe('lead-empresa');
    const posts = crm.lines.filter((line) => line.includes('POST'));
    expect(posts).toHaveLength(1);
    for (const part of ['POST', '/api/leads', '201', 'L-1']) expect(posts[0]).toContain(part);
    const log = crm.lines.join('\n');
    for (const forbidden of ['Ana', 'ana@example.com', '51+', 'empresa', 't-1']) expect(log, forbidden).not.toContain(forbidden);
    expect(api.output()).not.toContain('t-1');
  });

  it('Lead con otro token', async () => {
    const crm = await startCrmWith(TOKEN_1);
    const { api, base } = await startDemoApi(TOKEN_2, crm.port);
    const body = await choose(base, await leadReady(base, crm.port), 'grande');
    expect(body.events.filter((event: { type: string }) => event.type === 'http')).toEqual([{ type: 'http', nodeId: 'enviar-crm', attempts: 1, status: 401, error: 'http_status' }]);
    expect(body.conversation.outcome).toBe('lead-sin-enviar');
    expect(crm.lines.filter((line) => line.includes('POST'))).toEqual(['[crm simulado] POST /api/leads 401']);
    expect(api.output()).not.toContain('t-2');
  });

  it('Línea de arranque de la API en la demo', async () => {
    const { api } = await startDemoApi(TOKEN_1, 4010);
    await api.stop();
    const line = api.output().split('\n').find((candidate) => candidate.includes('salida http:'));
    expect(line).toBeDefined();
    for (const part of ['CRM_TOKEN', 'http://crm.franca.test:4010', '127.0.0.1:4010', 'crm.franca.test']) expect(line, part).toContain(part);
    expect(api.output()).not.toContain('t-1');
    expect(api.output()).toContain('sin proveedor llm principal');
  });

  it('Copia local sin la demo', async () => {
    const world = await startWorld();
    try {
      await world.ctx.publish(copy);
      const { id } = await world.ctx.start('captacion-leads-local');
      await world.ctx.say(id, { text: 'Ana' });
      await world.ctx.say(id, { text: 'ana@example.com' });
      const body = await world.sendSize(id);
      expect(body.conversation).toMatchObject({ status: 'failed', error: { code: 'missing_secret', nodeId: 'enviar-crm' } });
      expect(world.network.connections()).toEqual([]);
    } finally {
      await world.close();
    }
  });
});
