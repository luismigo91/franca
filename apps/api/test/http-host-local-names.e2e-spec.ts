import { afterEach, describe, expect, it } from 'vitest';
import { httpChain, httpEvents, leadsWith } from './helpers/http-flows.js';
import { CRM_RESPONSE, P, startWorld, type HttpWorld } from './helpers/http-world.js';

/** Las cuatro variables del CRM con nombre local (valores de prueba). */
const LOCAL_CRM_VARIABLES: Record<string, string> = {
  FRANCA_HTTP_LOCAL_NAMES: 'crm.franca.test=127.0.0.1',
  FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:4010',
  FRANCA_SECRET_CRM_TOKEN: 'Bearer prueba-crm-1', // gitleaks:allow
  FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=http://crm.franca.test:4010',
};

describe('salida http: nombres locales (e2e)', () => {
  let current: HttpWorld | undefined;
  const closeCurrent = async (): Promise<void> => {
    const previous = current;
    current = undefined;
    await previous?.close();
  };
  afterEach(closeCurrent);

  /** Una API nueva con las variables dadas; cierra la anterior. */
  async function world(variables: Record<string, string>): Promise<HttpWorld> {
    await closeCurrent();
    current = await startWorld({ variables });
    return current;
  }

  /** Publica `captacion-leads` con la `url` de `enviar-crm` en el nombre local y deja una conversación esperando en `pedir-tamano`. */
  async function localLeadsReady(w: HttpWorld): Promise<string> {
    await w.ctx.publish(leadsWith({ url: 'http://crm.franca.test:4010/api/leads' }));
    const { id } = await w.ctx.start('captacion-leads');
    await w.ctx.say(id, { text: 'Ana' });
    await w.ctx.say(id, { text: 'ana@example.com' });
    return id;
  }

  /** Un `GET` sin reintentos por cada URL, en una conversación, y sus eventos `http`. */
  async function get(w: HttpWorld, ...urls: string[]): Promise<any[]> {
    const flow = httpChain(urls.map((url) => ({ method: 'GET' as const, url, retries: 0 })));
    await w.ctx.publish(flow);
    const { body } = await w.ctx.start(flow.id);
    expect(body.conversation.status).toBe('ended');
    return httpEvents(body);
  }

  it('CRM con nombre local', async () => {
    const w = await world(LOCAL_CRM_VARIABLES);
    const server = await w.serveAt('127.0.0.1', 4010, CRM_RESPONSE);
    const id = await localLeadsReady(w);
    const body = await w.sendSize(id);
    expect(body.conversation.outcome).toBe('lead-empresa');
    const received = server.received();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', path: '/api/leads' });
    expect(received[0]!.headers['host']).toBe('crm.franca.test:4010');
    expect(received[0]!.headers['authorization']).toBe('Bearer prueba-crm-1');
    expect(w.network.connections()).toEqual([{ address: '127.0.0.1', port: 4010 }]);
    expect(w.network.resolved()).toEqual([]);
  });

  it('Nombre local en mayúsculas en la url', async () => {
    const w = await world({ FRANCA_HTTP_LOCAL_NAMES: 'api.franca.test=127.0.0.1', FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:4010' });
    const server = await w.serveAt('127.0.0.1', 4010, { kind: 'respond', status: 200 });
    const events = await get(w, 'http://API.Franca.TEST:4010/');
    expect(events).toEqual([{ type: 'http', nodeId: 'h1', attempts: 1, status: 200, error: null }]);
    expect(server.received()).toHaveLength(1);
    expect(w.network.resolved()).toEqual([]);
  });

  it('Nombre local sin destino permitido', async () => {
    const { FRANCA_HTTP_ALLOWED_DESTINATIONS: _omitted, ...withoutAllowed } = LOCAL_CRM_VARIABLES;
    const w = await world(withoutAllowed);
    const server = await w.serveAt('127.0.0.1', 4010, CRM_RESPONSE);
    const id = await localLeadsReady(w);
    const body = await w.sendSize(id);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'enviar-crm', attempts: 1, status: null, error: 'blocked' }]);
    expect(body.conversation.outcome).toBe('lead-sin-enviar');
    expect(w.network.connections()).toEqual([]);
    expect(server.connections()).toBe(0);
    expect(w.network.resolved()).toEqual([]);
    expect(w.output.text()).toMatch(/blocked en el nodo enviar-crm \(internal_destination\)/);
  });

  it('Orden de las direcciones de un nombre local', async () => {
    const w = await world({
      FRANCA_HTTP_LOCAL_NAMES: 'api.franca.test=[::1],api.franca.test=127.0.0.1',
      FRANCA_HTTP_ALLOWED_DESTINATIONS: '[::1]:4010,127.0.0.1:4010',
    });
    const server = await w.serveAt('127.0.0.1', 4010, { kind: 'respond', status: 200 });
    const events = await get(w, 'http://api.franca.test:4010/');
    expect(events).toEqual([{ type: 'http', nodeId: 'h1', attempts: 1, status: 200, error: null }]);
    expect(w.network.connections()).toEqual([
      { address: '::1', port: 4010 },
      { address: '127.0.0.1', port: 4010 },
    ]);
    expect(server.received()).toHaveLength(1);
    expect(w.network.resolved()).toEqual([]);
  });

  it('Nombres que no son locales', async () => {
    const w = await world({ FRANCA_HTTP_LOCAL_NAMES: 'crm.franca.test=127.0.0.1' });
    w.network.resolve('api.example.com', [P]);
    await w.serveAt(P, 443, { kind: 'respond', status: 200 }, { tls: { hostname: 'api.example.com', authority: 'trusted' } });
    const events = await get(w, 'http://otro.franca.test:4010/', 'https://api.example.com/');
    expect(events).toEqual([
      { type: 'http', nodeId: 'h1', attempts: 1, status: null, error: 'network_error' },
      { type: 'http', nodeId: 'h2', attempts: 1, status: 200, error: null },
    ]);
    expect(w.network.resolved()).toEqual(['otro.franca.test', 'api.example.com']);
  });
});
