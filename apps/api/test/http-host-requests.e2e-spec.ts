import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { httpChain, httpEvents } from './helpers/http-flows.js';
import { CRM_VARIABLES, P, startWorld, type HttpWorld } from './helpers/http-world.js';
import type { Behaviour } from './helpers/test-servers.js';

const HTTPS_API = { tls: { hostname: 'api.example.com', authority: 'trusted' } } as const;

describe('salida http: peticiones (e2e)', () => {
  let world: HttpWorld;

  beforeAll(async () => {
    world = await startWorld({ variables: CRM_VARIABLES });
  });
  afterAll(() => world.close());
  beforeEach(() => world.reset());

  /** Publica una cadena de llamadas y la ejecuta; devuelve el cuerpo de la creación. */
  async function runChain(calls: Parameters<typeof httpChain>[0]) {
    const flow = httpChain(calls);
    await world.ctx.publish(flow);
    return world.ctx.start(flow.id);
  }

  /** `api.example.com` resuelve a `P` y un servidor TLS en `P:443` con el comportamiento dado. */
  async function api(behaviours: Behaviour | readonly Behaviour[]) {
    world.network.resolve('api.example.com', [P]);
    return world.serveAt(P, 443, behaviours, HTTPS_API);
  }

  it('Petición que recibe el CRM', async () => {
    const server = await world.crm();
    const id = await world.leadsReady();
    const body = await world.sendSize(id);
    expect(server.received()).toHaveLength(1);
    const [request] = server.received();
    expect(request).toMatchObject({ method: 'POST', path: '/api/leads', body: '{"name":"Ana","email":"ana@example.com","companySize":"51+","segment":"empresa"}' });
    expect(request!.headers['authorization']).toBe('Bearer prueba-crm-1');
    expect(request!.headers['content-type']).toBe('application/json');
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'lead-empresa' });
  });

  it('Cabeceras que recibe el servidor', async () => {
    const server = await api({ kind: 'respond', status: 200, headers: { 'set-cookie': 's=1' } });
    const url = 'https://api.example.com/x';
    const { body } = await runChain([
      { method: 'POST', url, body: { a: 1 }, headers: { 'X-Id': '1' } },
      { method: 'POST', url, body: { a: 1 }, headers: { 'X-Id': '1' } },
      { method: 'GET', url, headers: { 'User-Agent': 'Otro', 'Accept-Encoding': 'identity' } },
    ]);
    expect(body.conversation.status).toBe('ended');
    const [first, second, third] = server.received();
    for (const request of [first, second]) {
      expect(Object.keys(request!.headers).sort()).toEqual(['accept-encoding', 'connection', 'content-length', 'content-type', 'host', 'user-agent', 'x-id']);
      expect(request!.headers).toMatchObject({ host: 'api.example.com', 'content-length': '7', connection: 'close', 'accept-encoding': 'gzip, deflate, br', 'user-agent': 'Franca', 'x-id': '1' });
    }
    expect(third!.headers['user-agent']).toBe('Otro');
    expect(third!.headers['accept-encoding']).toBe('identity');
    expect(third!.headers).not.toHaveProperty('cookie');
    expect(third!.headers).not.toHaveProperty('content-length');
    expect(Object.keys(third!.headers).sort()).toEqual(['accept-encoding', 'connection', 'host', 'user-agent']);

    // Sin body: POST lleva content-length 0 y DELETE ninguno.
    await world.servers.closeAll();
    await world.network.reset();
    const empty = await api({ kind: 'respond', status: 200 });
    const emptyFlow = httpChain([{ method: 'POST', url }, { method: 'DELETE', url }], 'sin-body');
    await world.ctx.publish(emptyFlow);
    await world.ctx.start('sin-body');
    const [post, remove] = empty.received();
    expect(post!.headers['content-length']).toBe('0');
    expect(remove!.headers).not.toHaveProperty('content-length');
  });

  it('Dos intentos, dos conexiones', async () => {
    const server = await api([
      { kind: 'respond', status: 503 },
      { kind: 'respond', status: 200 },
    ]);
    const { body } = await runChain([{ method: 'GET', url: 'https://api.example.com/x', retries: 1 }]);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'h1', attempts: 2, status: 200, error: null }]);
    expect(server.connections()).toBe(2);
    expect(world.network.resolutions('api.example.com')).toBe(2);
  });

  it('Lead que no se duplica', async () => {
    const server = await world.crm({ kind: 'read-and-close' });
    const id = await world.leadsReady();
    const body = await world.sendSize(id);
    expect(server.received()).toHaveLength(1);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'enviar-crm', attempts: 1, status: null, error: 'network_error' }]);
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'lead-sin-enviar' });
  });

  it('Status fuera de rango', async () => {
    await api([
      { kind: 'respond', status: 600 },
      { kind: 'respond', status: 200, headers: { 'content-encoding': 'gzip' }, body: 'esto no es gzip' },
    ]);
    const url = 'https://api.example.com/x';
    const { body } = await runChain([
      { method: 'GET', url, retries: 0 },
      { method: 'GET', url, retries: 0 },
    ]);
    expect(httpEvents(body)).toEqual([
      { type: 'http', nodeId: 'h1', attempts: 1, status: null, error: 'network_error' },
      { type: 'http', nodeId: 'h2', attempts: 1, status: null, error: 'network_error' },
    ]);
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'fin' });
    expect(body.events.some((event: any) => event.type === 'error')).toBe(false);
  });

  it('un servidor que responde 101 Switching Protocols da network_error enseguida, sin esperar al timeoutMs (D15)', async () => {
    const server = await api({ kind: 'switching-protocols' });
    const started = Date.now();
    // POST con reintentos: si requestSent fuera false se reintentaría; con true no (attempts 1).
    const { body } = await runChain([{ method: 'POST', url: 'https://api.example.com/x', body: { a: 1 }, timeoutMs: 8000, retries: 2 }]);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'h1', attempts: 1, status: null, error: 'network_error' }]);
    expect(server.received()).toHaveLength(1);
  });
});
