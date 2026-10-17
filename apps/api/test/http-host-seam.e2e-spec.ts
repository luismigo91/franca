import { connect as tlsConnect } from 'node:tls';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { httpChain, httpEvents } from './helpers/http-flows.js';
import { CRM_VARIABLES, P, startWorld, type HttpWorld } from './helpers/http-world.js';
import { trustedAuthority, untrustedAuthority } from './helpers/test-pki.js';
import { TestServers } from './helpers/test-servers.js';

/** La conversación del CRM hasta el final; devuelve el `outcome`. */
async function runCrm(world: HttpWorld): Promise<string | null> {
  const id = await world.leadsReady();
  const body = await world.sendSize(id);
  return body.conversation.outcome;
}

describe('costura de red de la salida http: canario y escenario positivo (e2e)', () => {
  let world: HttpWorld;

  beforeAll(async () => {
    world = await startWorld({ variables: CRM_VARIABLES });
  });
  afterAll(() => world.close());
  beforeEach(() => world.reset());

  it('canario: con un abridor que rechaza todo el servidor real no recibe ninguna conexión y el lead queda sin enviar', async () => {
    // El servidor existe y el nombre resuelve, pero ningún par está registrado: el abridor rechaza todo.
    world.network.resolve('crm.example.com', [P]);
    const server = await world.servers.start({ kind: 'respond', status: 201, body: '{"id":"L-1"}' }, { tls: { hostname: 'crm.example.com', authority: 'trusted' } });
    expect(await runCrm(world)).toBe('lead-sin-enviar');
    expect(server.connections()).toBe(0);
    expect(world.network.connections().length).toBeGreaterThan(0);
  });

  it('canario: con un resolutor que no conoce nombres el abridor no se llama', async () => {
    const server = await world.servers.start({ kind: 'respond', status: 201 }, { tls: { hostname: 'crm.example.com', authority: 'trusted' } });
    world.network.mapPair(P, 443, server);
    expect(await runCrm(world)).toBe('lead-sin-enviar');
    expect(world.network.connections()).toEqual([]);
    expect(server.connections()).toBe(0);
  });

  it('la misma conversación con la red completa termina en lead-empresa', async () => {
    const server = await world.crm();
    expect(await runCrm(world)).toBe('lead-empresa');
    expect(server.received()).toHaveLength(1);
    expect(world.network.connections()).toEqual([{ address: P, port: 443 }]);
  });
});

describe('red del test: lo que garantiza de sí misma (e2e)', () => {
  let world: HttpWorld;

  beforeAll(async () => {
    world = await startWorld({ variables: { FRANCA_HTTP_ALLOWED_DESTINATIONS: '1.2.3.4:80' } });
  });
  afterAll(() => world.close());
  beforeEach(() => world.reset());

  it('un par no registrado se rechaza aunque haya un servidor en 127.0.0.1 con ese puerto, y todo open queda registrado', async () => {
    const server = await world.servers.start({ kind: 'respond', status: 200 });
    world.network.resolve('local.example.com', [P]);
    // El par (P, <puerto real>) no está registrado; el servidor real escucha en 127.0.0.1:<puerto real>.
    const flow = httpChain([{ method: 'GET', url: `https://local.example.com:${server.port}/`, retries: 0 }]);
    await world.ctx.publish(flow);
    const { body } = await world.ctx.start(flow.id);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'h1', attempts: 1, status: null, error: 'network_error' }]);
    expect(server.connections()).toBe(0);
    expect(world.network.connections()).toEqual([{ address: P, port: server.port }]);
  });

  it('un par virtual no puede ser el puerto real de un servidor', async () => {
    const server = await world.servers.start({ kind: 'respond', status: 200 });
    expect(() => world.network.mapPair('127.0.0.1', server.port, server)).toThrow(/virtuales/);
    const other = await world.servers.start({ kind: 'respond', status: 200 });
    expect(() => world.network.mapPair('127.0.0.1', server.port, other)).toThrow(/virtuales/);
  });

  it('el abridor registra la conexión también cuando la rechaza', async () => {
    world.network.resolve('sin-servidor.example.com', [P]);
    const flow = httpChain([{ method: 'GET', url: 'http://sin-servidor.example.com/', retries: 0 }], 'abierto-y-rechazado');
    await world.ctx.publish(flow);
    // http:// hacia P solo llega a un par permitido; (1.2.3.4, 80) lo es y no tiene servidor.
    await world.ctx.start(flow.id);
    expect(world.network.connections()).toEqual([{ address: P, port: 80 }]);
  });
});

describe('PKI del test (e2e)', () => {
  const servers = new TestServers();
  afterAll(() => servers.closeAll());

  /** Se conecta sin rechazar nada y devuelve si el certificado queda autorizado y por qué no. */
  async function probe(port: number, options: { servername: string; ca?: string[] }): Promise<{ authorized: boolean; error: string | null }> {
    return new Promise((resolve, reject) => {
      const socket = tlsConnect({ host: '127.0.0.1', port, servername: options.servername, ca: options.ca, rejectUnauthorized: false }, () => {
        resolve({ authorized: socket.authorized, error: socket.authorizationError ? String(socket.authorizationError) : null });
        socket.destroy();
      });
      socket.on('error', reject);
    });
  }

  it('el certificado verifica con su autoridad y falla sin ella, con otra autoridad o con otro nombre', async () => {
    const trusted = await servers.start({ kind: 'respond', status: 200 }, { tls: { hostname: 'crm.example.com', authority: 'trusted' } });
    const untrusted = await servers.start({ kind: 'respond', status: 200 }, { tls: { hostname: 'crm.example.com', authority: 'untrusted' } });
    expect(await probe(trusted.port, { servername: 'crm.example.com', ca: [trustedAuthority.certificate] })).toEqual({ authorized: true, error: null });
    const withoutCa = await probe(trusted.port, { servername: 'crm.example.com' });
    expect(withoutCa.authorized).toBe(false);
    expect(withoutCa.error).toMatch(/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED|UNABLE_TO_GET_ISSUER/);
    const otherAuthority = await probe(untrusted.port, { servername: 'crm.example.com', ca: [trustedAuthority.certificate] });
    expect(otherAuthority.authorized).toBe(false);
    expect(await probe(untrusted.port, { servername: 'crm.example.com', ca: [untrustedAuthority.certificate] })).toEqual({ authorized: true, error: null });
    const otherName = await probe(trusted.port, { servername: 'otro.example.com', ca: [trustedAuthority.certificate] });
    expect(otherName).toEqual({ authorized: false, error: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  });
});
