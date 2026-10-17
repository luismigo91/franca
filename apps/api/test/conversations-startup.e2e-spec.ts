import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeAll, afterAll, describe, expect, inject, it } from 'vitest';
import { createTestPrisma } from './helpers/database.js';
import { faq } from './helpers/examples.js';
import { resetConversations } from './helpers/conversations.js';
import { startApi, type RunningApi } from './helpers/process.js';
import { rawRequest } from './helpers/raw.js';

const FAKE_DATABASE_URL = 'postgresql://usuario:no-mostrar-1234@127.0.0.1:59999/franca';
const BUDGET = 'FRANCA_CONVERSATION_COST_LIMIT_USD';

/** Un servidor TCP local que cuenta las conexiones que recibe: el destino de `ANTHROPIC_BASE_URL` en los e2e de proceso. */
async function startConnectionCounter(): Promise<{ port: number; count(): number; close(): Promise<void> }> {
  let connections = 0;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    count: () => connections,
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('arranque del proceso real con las conversaciones', () => {
  const running: RunningApi[] = [];
  const start = (env: Record<string, string>) => {
    const api = startApi(env);
    running.push(api);
    return api;
  };

  afterEach(async () => {
    await Promise.all(running.splice(0).map((api) => api.stop()));
  });

  it('Presupuestos no admitidos', async () => {
    const invalid = ['abc', '0', '-1', '1e3', '1001', '', ' 1'];
    // Cada valor por separado y en paralelo: ninguno llega a escuchar, todos terminan con error nombrando la variable.
    const apis = invalid.map((value) => start({ DATABASE_URL: FAKE_DATABASE_URL, PORT: '0', [BUDGET]: value }));
    const codes = await Promise.all(apis.map((api) => api.exited));
    apis.forEach((api, index) => {
      expect(codes[index], `valor ${JSON.stringify(invalid[index])}`).not.toBe(0);
      expect(codes[index]).not.toBeNull();
      expect(api.listening()).toBeUndefined();
      expect(api.output()).toContain(BUDGET);
      expect(api.output()).not.toContain('no-mostrar-1234');
      expect(api.output()).not.toContain('escuchando');
    });
    for (const value of ['0.01', '1000']) {
      const api = start({ DATABASE_URL: FAKE_DATABASE_URL, PORT: '0', [BUDGET]: value });
      expect(await api.whenListening(), `valor ${value}`).toBeDefined();
    }
  });

  it('la salida de arranque con FRANCA_ANTHROPIC_API_KEY dice que hay proveedor y no contiene la clave', async () => {
    const counter = await startConnectionCounter();
    try {
      const api = start({ DATABASE_URL: FAKE_DATABASE_URL, PORT: '0', FRANCA_ANTHROPIC_API_KEY: 'clave-de-prueba', ANTHROPIC_BASE_URL: `http://127.0.0.1:${counter.port}` });
      expect(await api.whenListening()).toBeDefined();
      await api.stop();
      expect(api.output()).toContain('proveedor llm principal: Claude');
      expect(api.output()).not.toContain('sin proveedor llm principal');
      expect(api.output()).not.toContain('clave-de-prueba');
      // Crear el proveedor no abre conexiones, y menos a la URL base del entorno.
      expect(counter.count()).toBe(0);
    } finally {
      await counter.close();
    }
  });

  describe('con una base de datos real', () => {
    const prisma = createTestPrisma();
    beforeAll(() => resetConversations(prisma));
    afterAll(() => prisma.$disconnect());

    it('Solo la variable del SDK', async () => {
      await resetConversations(prisma);
      const counter = await startConnectionCounter();
      try {
        const api = start({
          DATABASE_URL: inject('databaseUrl'),
          PORT: '0',
          ANTHROPIC_API_KEY: 'sk-no-usar',
          ANTHROPIC_AUTH_TOKEN: 'token-no-usar',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${counter.port}`,
          ANTHROPIC_CUSTOM_HEADERS: 'x-api-key: otra-clave',
        });
        const address = await api.whenListening();
        expect(address).toBeDefined();
        const json = { 'content-type': 'application/json' };
        const post = (path: string, body?: string) => rawRequest(address!.port, { method: 'POST', path, headers: json, body });
        expect((await post('/flows', JSON.stringify(faq()))).status).toBe(201);
        expect((await post('/flows/faq-ia/versions')).status).toBe(201);
        const created = await post('/conversations', JSON.stringify({ flowId: 'faq-ia' }));
        expect(created.status).toBe(201);
        expect(created.json.conversation).toMatchObject({ status: 'failed', error: { code: 'llm_not_configured', nodeId: 'asistente' } });

        await api.stop();
        expect(counter.count()).toBe(0);
        expect(api.output()).toContain('sin proveedor llm principal');
        for (const secret of ['sk-no-usar', 'token-no-usar', 'otra-clave']) expect(api.output()).not.toContain(secret);
      } finally {
        await counter.close();
      }
    });
  });
});
