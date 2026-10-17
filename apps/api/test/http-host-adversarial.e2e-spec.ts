import { createServer, type Socket } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leads } from './helpers/examples.js';
import { httpChain, httpEvents, leadsWith } from './helpers/http-flows.js';
import { CRM_VARIABLES, P, startWorld, type HttpWorld } from './helpers/http-world.js';

const HTTPS_API = { tls: { hostname: 'api.example.com', authority: 'trusted' } } as const;

describe('salida http: costuras bajo presión (e2e)', () => {
  let world: HttpWorld;

  beforeAll(async () => {
    world = await startWorld({ variables: { ...CRM_VARIABLES, FRANCA_HTTP_ALLOWED_DESTINATIONS: '1.2.3.4:80' } });
  });
  afterAll(() => world.close());
  beforeEach(() => world.reset());

  async function waitFor(condition: () => boolean, limitMs = 5000): Promise<void> {
    const deadline = Date.now() + limitMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('la condición no se cumplió a tiempo');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('cada intento valida su propia resolución: si la segunda mezcla una dirección interna, se bloquea', async () => {
    world.network.resolve('api.example.com', [P], [P, '10.0.0.5'], [P]);
    const server = await world.serveAt(P, 443, { kind: 'respond', status: 503 }, HTTPS_API);
    const flow = httpChain([{ method: 'GET', url: 'https://api.example.com/x', retries: 2 }]);
    await world.ctx.publish(flow);
    const { body } = await world.ctx.start(flow.id);
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'h1', attempts: 2, status: null, error: 'blocked' }]);
    expect(server.connections()).toBe(1);
    expect(world.network.resolutions('api.example.com')).toBe(2);
  });

  it('20 conversaciones a la vez contra el mismo servidor: una conexión por intento y ninguna cruzada', async () => {
    const server = await world.crm({ kind: 'respond', status: 201, body: '{"id":"L-1"}' });
    await world.ctx.publish(leads());
    const count = 20;
    const outcomes = await Promise.all(
      Array.from({ length: count }, async (_unused, index) => {
        const { id } = await world.ctx.start('captacion-leads');
        await world.ctx.say(id, { text: `Persona${index}` });
        await world.ctx.say(id, { text: `persona${index}@example.com` });
        return (await world.ctx.say(id, { choice: 'grande' })).conversation.outcome as string;
      }),
    );
    expect(outcomes).toEqual(Array(count).fill('lead-empresa'));
    expect(server.received()).toHaveLength(count);
    expect(server.connections()).toBe(count);
    const names = server.received().map((request) => (JSON.parse(request.body) as { name: string }).name);
    expect(new Set(names).size).toBe(count);
    expect([...names].sort()).toEqual(Array.from({ length: count }, (_unused, index) => `Persona${index}`).sort());
    expect(world.network.connections()).toHaveLength(count);
  });

  it('un servidor que responde sin leer el body y cierra no cuelga el intento', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
      socket.end('HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      world.network.resolve('api.example.com', [P]);
      world.network.mapPair(P, 80, { port: (server.address() as { port: number }).port } as never);
      const flow = httpChain([{ method: 'POST', url: 'http://api.example.com/x', body: { datos: 'x'.repeat(2000) }, timeoutMs: 3000, retries: 0 }]);
      await world.ctx.publish(flow);
      const started = Date.now();
      const { body } = await world.ctx.start(flow.id);
      expect(Date.now() - started).toBeLessThan(2500);
      const [event] = httpEvents(body);
      expect(event.attempts).toBe(1);
      expect([413, null]).toContain(event.status);
      expect(body.conversation.status).toBe('ended');
    } finally {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('cabeceras de respuesta de 64 KiB: el límite de 16 KiB las rechaza como network_error', async () => {
    world.network.resolve('api.example.com', [P]);
    await world.serveAt(P, 443, { kind: 'respond', status: 200, headers: { 'x-grande': 'a'.repeat(65_536) } }, HTTPS_API);
    const flow = httpChain([{ method: 'POST', url: 'https://api.example.com/x', body: { a: 1 }, retries: 2 }]);
    await world.ctx.publish(flow);
    const { body } = await world.ctx.start(flow.id);
    // POST con envío posible: no se reintenta.
    expect(httpEvents(body)).toEqual([{ type: 'http', nodeId: 'h1', attempts: 1, status: null, error: 'network_error' }]);
  });

  it('borrar la conversación durante un intento colgado descarta el resultado y no deja nada abierto', async () => {
    const server = await world.crm({ kind: 'stall-headers' });
    await world.ctx.publish(leadsWith({ timeoutMs: 1500 }));
    const { id } = await world.ctx.start('captacion-leads');
    await world.ctx.say(id, { text: 'Ana' });
    await world.ctx.say(id, { text: 'ana@example.com' });
    const pending = world.ctx.conv.send(id, { input: { choice: 'grande' } }).then((response) => response);
    await waitFor(() => server.received().length === 1);
    await world.ctx.conv.remove(id).expect(204);
    const response = await pending;
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('conversation_not_found');
    // El intento colgado vence por su plazo y cierra su conexión: no queda nada abierto.
    await waitFor(() => server.openConnections() === 0);
    expect((await world.ctx.conv.get(id)).status).toBe(404);
  });
});
