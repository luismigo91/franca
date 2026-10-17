import { afterEach, describe, expect, it } from 'vitest';
import { httpChain, httpEvents } from './helpers/http-flows.js';
import { CRM_VARIABLES, P, P1, startWorld, type HttpWorld } from './helpers/http-world.js';

const TLS_API = { tls: { hostname: 'api.example.com', authority: 'trusted' } } as const;
const BLOCKED = { attempts: 1, status: null, error: 'blocked' };

describe('salida http: destinos (e2e)', () => {
  let current: HttpWorld | undefined;
  const closeCurrent = async (): Promise<void> => {
    const previous = current;
    current = undefined;
    await previous?.close();
  };
  afterEach(closeCurrent);

  /** Una API nueva con las variables dadas; cierra la anterior. */
  async function world(variables: Record<string, string> = {}): Promise<HttpWorld> {
    await closeCurrent();
    current = await startWorld({ variables });
    return current;
  }

  /** Ejecuta un `GET` sin reintentos por cada URL, en una conversación, y devuelve sus eventos `http`. */
  async function get(w: HttpWorld, ...urls: string[]): Promise<any[]> {
    const flow = httpChain(urls.map((url) => ({ method: 'GET' as const, url, retries: 0 })));
    await w.ctx.publish(flow);
    const { body } = await w.ctx.start(flow.id);
    expect(body.conversation.status).toBe('ended');
    return httpEvents(body);
  }

  it('Destino local permitido', async () => {
    const w = await world({ FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080' });
    w.network.resolve('crm.local.test', ['127.0.0.1']);
    const server = await w.serveAt('127.0.0.1', 8080, { kind: 'respond', status: 200 });
    const events = await get(w, 'http://crm.local.test:8080/', 'http://crm.local.test:8081/');
    expect(events).toEqual([
      { type: 'http', nodeId: 'h1', attempts: 1, status: 200, error: null },
      { type: 'http', nodeId: 'h2', ...BLOCKED },
    ]);
    expect(server.received()).toHaveLength(1);
    expect(w.network.connectionsTo('127.0.0.1', 8081)).toBe(0);
    expect(w.network.connections()).toEqual([{ address: '127.0.0.1', port: 8080 }]);
  });

  it('Dirección permitida escrita de otra forma', async () => {
    const w = await world({ FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080,[::1]:8443' });
    w.network.resolve('a.local.test', ['::ffff:7f00:1']);
    w.network.resolve('b.local.test', ['0:0:0:0:0:0:0:1']);
    await w.serveAt('127.0.0.1', 8080, { kind: 'respond', status: 200 });
    await w.serveAt('::1', 8443, { kind: 'respond', status: 200 });
    const events = await get(w, 'http://a.local.test:8080/', 'http://b.local.test:8443/');
    expect(events.map((event) => event.status)).toEqual([200, 200]);
    expect(events.map((event) => event.error)).toEqual([null, null]);
  });

  it('Rangos IPv4 que no son globales', async () => {
    const w = await world();
    const addresses = ['198.51.100.7', '203.0.113.7', '192.0.0.8', '100.127.255.254', '127.255.255.255', '239.255.255.250'];
    addresses.forEach((address, index) => w.network.resolve(`v4-${index}.example.com`, [address]));
    const events = await get(w, ...addresses.map((_address, index) => `https://v4-${index}.example.com/`));
    expect(events.map(({ type: _type, nodeId: _nodeId, ...rest }) => rest)).toEqual(addresses.map(() => BLOCKED));
    expect(w.network.connections()).toEqual([]);
    expect(w.network.resolved()).toHaveLength(addresses.length);
  });

  it('IPv4 pública detrás de NAT64', async () => {
    const w = await world();
    w.network.resolve('api.example.com', ['64:ff9b::1.2.3.4']);
    const server = await w.serveAt('64:ff9b::102:304', 443, { kind: 'respond', status: 200 }, TLS_API);
    const events = await get(w, 'https://api.example.com/');
    expect(events).toEqual([{ type: 'http', nodeId: 'h1', attempts: 1, status: 200, error: null }]);
    expect(server.received()).toHaveLength(1);
    expect(w.network.connections()).toEqual([{ address: '64:ff9b::102:304', port: 443 }]);
  });

  it('Rangos IPv6 que no son globales', async () => {
    const w = await world();
    const addresses = ['2001:db8::7', '100::1', '2002:102:304::1', '2001::1', '64:ff9b:1::102:304', '64:ff9b::a00:5', '::ffff:192.168.1.1', '4000::1'];
    addresses.forEach((address, index) => w.network.resolve(`v6-${index}.example.com`, [address]));
    const events = await get(w, ...addresses.map((_address, index) => `https://v6-${index}.example.com/`));
    expect(events.map(({ type: _type, nodeId: _nodeId, ...rest }) => rest)).toEqual(addresses.map(() => BLOCKED));
    expect(w.network.connections()).toEqual([]);
  });

  it('Resolución con una dirección interna', async () => {
    const w = await world(CRM_VARIABLES);
    const server = await w.crm();
    w.network.resolve('crm.example.com', [P, '10.0.0.5']);
    const id = await w.leadsReady();
    const body = await w.sendSize(id);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'enviar-crm', ...BLOCKED }]);
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'lead-sin-enviar' });
    expect(w.network.connections()).toEqual([]);
    expect(server.connections()).toBe(0);
  });

  it('Primera dirección que rechaza la conexión', async () => {
    const w = await world(CRM_VARIABLES);
    const server = await w.crm();
    w.network.resolve('crm.example.com', [P1, P]);
    const id = await w.leadsReady();
    const body = await w.sendSize(id);
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'lead-empresa' });
    expect(server.received()).toHaveLength(1);
    expect(w.network.connections()).toEqual([
      { address: P1, port: 443 },
      { address: P, port: 443 },
    ]);
  });

  it('Nombre que no existe', async () => {
    const w = await world(CRM_VARIABLES);
    const id = await w.leadsReady();
    const body = await w.sendSize(id);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'enviar-crm', attempts: 3, status: null, error: 'network_error' }]);
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'lead-sin-enviar' });
    expect(w.network.resolutions('crm.example.com')).toBe(3);
    expect(w.network.connections()).toEqual([]);
  });

  it('http sin TLS hacia una dirección pública', async () => {
    const w = await world();
    w.network.resolve('api.example.com', [P]);
    const server = await w.serveAt(P, 80, { kind: 'respond', status: 200 });
    const events = await get(w, 'http://api.example.com/');
    expect(events).toEqual([{ type: 'http', nodeId: 'h1', ...BLOCKED }]);
    expect(server.connections()).toBe(0);
    expect(w.network.connections()).toEqual([]);
  });
});
