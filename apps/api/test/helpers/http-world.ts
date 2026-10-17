import { ResettableOutput } from './conversations-harness.js';
import { leads, startConversationsContext, type ConversationsContext } from './conversations.js';
import { TestNetwork } from './test-network.js';
import { TestServers, type Behaviour, type StartOptions, type TestServer } from './test-servers.js';

/** Direcciones IPv4 unicast global distintas, solo virtuales: la red del test nunca conecta con ellas de verdad. */
export const P = '1.2.3.4';
export const P1 = '1.2.3.5';
export const P2 = '1.2.3.6';

/** Secretos y orígenes del «CRM del test» (valores de prueba). */
export const CRM_VARIABLES: Record<string, string> = {
  FRANCA_SECRET_CRM_TOKEN: 'Bearer prueba-crm-1', // gitleaks:allow
  FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=https://crm.example.com',
};

export const CRM_RESPONSE: Behaviour = { kind: 'respond', status: 201, body: '{"id":"L-1"}' };

export interface HttpWorld {
  readonly ctx: ConversationsContext;
  readonly network: TestNetwork;
  readonly servers: TestServers;
  readonly output: ResettableOutput;
  /** Levanta un servidor real y lleva el par virtual `address:port` a él. */
  serveAt(address: string, port: number, behaviours: Behaviour | readonly Behaviour[], options?: StartOptions): Promise<TestServer>;
  /** El CRM del test: `crm.example.com` resuelve a `P` y un servidor TLS en `P:443` con certificado de ese nombre. */
  crm(behaviours?: Behaviour | readonly Behaviour[], options?: StartOptions): Promise<TestServer>;
  /** Publica `captacion-leads` y deja una conversación esperando en `pedir-tamano`; devuelve su `id`. */
  leadsReady(): Promise<string>;
  /** Envía la elección de tamaño (por defecto `grande`) y devuelve el cuerpo del avance. */
  sendSize(id: string, choice?: string): Promise<any>;
  /** Vacía la base, los servidores, la red, la salida y el reloj. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * La API completa con la red del test y la salida capturada. `variables` son las que lee la configuración de la salida http
 * (`FRANCA_SECRET_*`, `FRANCA_HTTP_SECRET_ORIGINS`, `FRANCA_HTTP_ALLOWED_DESTINATIONS`).
 */
export async function startWorld(options: { variables?: Record<string, string> } = {}): Promise<HttpWorld> {
  const output = new ResettableOutput();
  output.install();
  const network = await TestNetwork.create();
  const servers = new TestServers();
  let ctx: ConversationsContext;
  try {
    ctx = await startConversationsContext({ logger: output.logger, http: { variables: options.variables ?? {}, network } });
  } catch (error) {
    output.uninstall();
    throw error;
  }
  // La base es compartida por todos los ficheros: cada mundo empieza vacío (la salida de arranque se conserva).
  await ctx.reset();
  const world: HttpWorld = {
    ctx,
    network,
    servers,
    output,
    async serveAt(address, port, behaviours, startOptions) {
      const server = await servers.start(behaviours, startOptions);
      network.mapPair(address, port, server);
      return server;
    },
    async crm(behaviours = CRM_RESPONSE, startOptions = { tls: { hostname: 'crm.example.com', authority: 'trusted' } }) {
      network.resolve('crm.example.com', [P]);
      return world.serveAt(P, 443, behaviours, startOptions);
    },
    async leadsReady() {
      await ctx.publish(leads());
      const { id } = await ctx.start('captacion-leads');
      await ctx.say(id, { text: 'Ana' });
      await ctx.say(id, { text: 'ana@example.com' });
      return id;
    },
    sendSize: (id, choice = 'grande') => ctx.say(id, { choice }),
    async reset() {
      await servers.closeAll();
      await network.reset();
      await ctx.reset();
      output.clear();
    },
    async close() {
      await servers.closeAll();
      await ctx.close();
      output.uninstall();
    },
  };
  return world;
}
