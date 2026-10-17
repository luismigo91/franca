import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpChain, httpEvents } from './helpers/http-flows.js';
import { CRM_RESPONSE, CRM_VARIABLES, startWorld, type HttpWorld } from './helpers/http-world.js';

/** La tolerancia del entorno de los casos de tiempo: la del catálogo de conformidad del motor. */
const TOLERANCE_MS = 1500;

describe('salida http: certificado y tiempo (e2e)', () => {
  let world: HttpWorld;

  beforeAll(async () => {
    world = await startWorld({ variables: CRM_VARIABLES });
  });
  afterAll(() => world.close());
  beforeEach(() => world.reset());
  afterEach(() => vi.unstubAllEnvs());

  it('Certificado de otro nombre', async () => {
    const server = await world.crm(CRM_RESPONSE, { tls: { hostname: 'otro.example.com', authority: 'trusted' } });
    const id = await world.leadsReady();
    const body = await world.sendSize(id);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'enviar-crm', attempts: 3, status: null, error: 'network_error' }]);
    expect(server.received()).toHaveLength(0);
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'lead-sin-enviar' });
    // El handshake sí llegó al servidor: la verificación es de la API, no un fallo de red.
    expect(server.connections()).toBeGreaterThan(0);
  });

  it('Verificación de TLS desactivada en el entorno', async () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    // El certificado lo firma una autoridad que la API no acepta.
    const server = await world.crm(CRM_RESPONSE, { tls: { hostname: 'crm.example.com', authority: 'untrusted' } });
    const id = await world.leadsReady();
    const body = await world.sendSize(id);
    expect(server.received()).toHaveLength(0);
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'lead-sin-enviar' });
    expect(server.connections()).toBeGreaterThan(0);
  });

  it('Resolución que no termina', async () => {
    world.network.hang('api.example.com');
    const flow = httpChain([{ method: 'GET', url: 'https://api.example.com/x', timeoutMs: 500, retries: 0 }]);
    await world.ctx.publish(flow);
    const started = Date.now();
    const { body } = await world.ctx.start(flow.id);
    const elapsed = Date.now() - started;
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'h1', attempts: 1, status: null, error: 'timeout' }]);
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThanOrEqual(500 + TOLERANCE_MS);
    expect(world.network.connections()).toEqual([]);
  });
});
