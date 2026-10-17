import { afterEach, describe, expect, it } from 'vitest';
import { dumpConversationTables, faq } from './helpers/conversations.js';
import { finishing } from './helpers/conversations-llm.js';
import { httpChain, httpEvents, llmHttp } from './helpers/http-flows.js';
import { CRM_VARIABLES, P, startWorld, type HttpWorld } from './helpers/http-world.js';

describe('salida http: secretos (e2e)', () => {
  let current: HttpWorld | undefined;
  const closeCurrent = async (): Promise<void> => {
    const previous = current;
    current = undefined;
    await previous?.close();
  };
  afterEach(closeCurrent);

  /** Una API nueva con las variables dadas (cada escenario fija su propia configuración); cierra la anterior. */
  async function world(variables: Record<string, string>): Promise<HttpWorld> {
    await closeCurrent();
    current = await startWorld({ variables });
    return current;
  }

  it('Secreto ausente sin resolver el nombre', async () => {
    const w = await world({});
    w.network.resolve('crm.example.com', ['10.0.0.5']);
    const id = await w.leadsReady();
    const body = await w.sendSize(id);
    expect(body.conversation).toMatchObject({ status: 'failed', error: { code: 'missing_secret', nodeId: 'enviar-crm' } });
    expect(w.network.resolutions('crm.example.com')).toBe(0);
    expect(w.network.resolved()).toEqual([]);
    expect(w.network.connections()).toEqual([]);
  });

  it('Secreto ausente fuera de plazo', async () => {
    const w = await world({});
    await w.ctx.publish(llmHttp({ secret: 'API_TOKEN' }));
    w.ctx.testApp.llm.use(() => {
      w.ctx.testApp.clock.advance(91_000);
      return finishing(0.01, 'Hola');
    });
    const { body } = await w.ctx.start('llm-http');
    expect(body.conversation).toMatchObject({ status: 'failed', error: { code: 'missing_secret', nodeId: 'h' } });
    expect(httpEvents(body)).toEqual([]);
    expect(w.network.resolutions('api.example.com')).toBe(0);
  });

  it('Secreto fuera de la API', async () => {
    const w = await world(CRM_VARIABLES);
    await w.crm({ kind: 'respond', status: 201, body: '{"id":"L-1","eco":"Bearer prueba-crm-1"}' });
    const id = await w.leadsReady();
    const sent = await w.sendSize(id);
    const read = await w.ctx.conv.get(id).expect(200);
    const transcript = await w.ctx.conv.transcript(id).expect(200);
    const rows = await dumpConversationTables(w.ctx.prisma);
    expect(sent.conversation.outcome).toBe('lead-empresa');
    for (const [label, text] of [
      ['respuesta del avance', JSON.stringify(sent)],
      ['conversación', read.text],
      ['transcripción', transcript.text],
      ['filas', rows],
      ['salida', w.output.text()],
    ] as const) {
      expect(text, label).not.toContain('prueba-crm-1');
    }
  });

  it('Secreto autorizado para otro origen', async () => {
    for (const origins of ['CRM_TOKEN=https://crm.example.com:8443', 'CRM_TOKEN=http://crm.example.com', 'CRM_TOKEN=https://api.crm.example.com']) {
      const w = await world({ ...CRM_VARIABLES, FRANCA_HTTP_SECRET_ORIGINS: origins });
      const server = await w.crm();
      const id = await w.leadsReady();
      const body = await w.sendSize(id);
      expect(body.conversation, origins).toMatchObject({ status: 'failed', error: { code: 'missing_secret', nodeId: 'enviar-crm' } });
      expect(w.network.connections(), origins).toEqual([]);
      expect(server.connections(), origins).toBe(0);
    }
  });

  it('Varios orígenes para un secreto', async () => {
    const w = await world({ ...CRM_VARIABLES, FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=https://crm.example.com,CRM_TOKEN=https://crm.example.com:8443' });
    w.network.resolve('crm.example.com', [P]);
    const tls = { tls: { hostname: 'crm.example.com', authority: 'trusted' } } as const;
    const first = await w.serveAt(P, 443, { kind: 'respond', status: 204 }, tls);
    const second = await w.serveAt(P, 8443, { kind: 'respond', status: 204 }, tls);
    const headers = { Authorization: { secret: 'CRM_TOKEN' } };
    const flow = httpChain([
      { method: 'GET', url: 'https://crm.example.com/', headers },
      { method: 'GET', url: 'https://crm.example.com:8443/', headers },
    ]);
    await w.ctx.publish(flow);
    const { body } = await w.ctx.start(flow.id);
    expect(httpEvents(body).map((event) => event.status)).toEqual([204, 204]);
    expect(first.received()[0]!.headers['authorization']).toBe('Bearer prueba-crm-1');
    expect(second.received()[0]!.headers['authorization']).toBe('Bearer prueba-crm-1');
  });

  it('Secreto sin origen ignorado', async () => {
    const w = await world({ FRANCA_SECRET_SOPORTE_TOKEN: 'Bearer no-mostrar-2' }); // gitleaks:allow
    await w.ctx.publish(faq());
    w.ctx.testApp.llm.use({ kind: 'failed', costUsd: 0 });
    const created = await w.ctx.start('faq-ia');
    const sent = await w.ctx.say(created.id, { text: 'ana@example.com' });
    expect(sent.conversation).toMatchObject({ status: 'failed', error: { code: 'missing_secret', nodeId: 'crear-ticket' } });
    const output = w.output.text();
    expect(output).toContain('FRANCA_SECRET_SOPORTE_TOKEN');
    expect(output).not.toContain('no-mostrar-2');
  });
});
