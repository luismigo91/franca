import { Logger, type LoggerService } from '@nestjs/common';
import { vi, type MockInstance } from 'vitest';
import type { ConformanceServer, ConformanceSessions, Connection, HostConformanceHarness, ServeOptions, ServerBehaviour } from '@franca/engine/conformance';
import type { HttpCapability, LlmCapability, SessionStatus } from '@franca/engine';
import { createAdvanceLlm } from '../../src/conversations/advance-llm.js';
import { CLAIM_TTL_MS } from '../../src/conversations/conversation-timing.js';
import { destinationKey } from '../../src/http-host/addresses.js';
import { createHttpHost } from '../../src/http-host/http-host.js';
import { createLoggerNotices } from '../../src/http-host/notices.js';
import { createSecretStore, type InstalledSecret, type SecretStore } from '../../src/http-host/secrets.js';
import { resetConversations, type ConversationsContext } from './conversations.js';
import { TestServers } from './test-servers.js';

/** Salida de registro que se puede vaciar: el logger de Nest y lo que se escribe en `stdout`/`stderr`. */
export class ResettableOutput {
  private lines: string[] = [];
  readonly logger: LoggerService;
  private readonly originalWrites: { stream: NodeJS.WriteStream; write: NodeJS.WriteStream['write'] }[] = [];
  private consoleSpies: MockInstance[] = [];

  constructor() {
    const push =
      (level: string) =>
      (message: unknown, ...rest: unknown[]) => {
        const parts = [message, ...rest].filter((part) => part !== undefined && part !== '');
        this.lines.push(`${level} ${parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')}`);
      };
    this.logger = { log: push('log'), error: push('error'), warn: push('warn'), debug: push('debug'), verbose: push('verbose') };
  }

  /**
   * Empieza a capturar: sustituye el logger estático de Nest, las escrituras en `stdout`/`stderr` y `console.*` (que
   * Vitest intercepta antes de `stdout`, así que un `console.log` perdido no llegaría de otro modo).
   */
  install(): void {
    Logger.overrideLogger(this.logger);
    this.consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        this.lines.push(`${level} ${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
      }),
    );
    for (const stream of [process.stdout, process.stderr]) {
      const write: NodeJS.WriteStream['write'] = stream.write.bind(stream);
      this.originalWrites.push({ stream, write });
      stream.write = ((chunk: unknown) => {
        this.lines.push(String(chunk));
        return true;
      }) as typeof stream.write;
    }
  }

  uninstall(): void {
    this.consoleSpies.forEach((spy) => spy.mockRestore());
    this.consoleSpies = [];
    for (const { stream, write } of this.originalWrites.splice(0)) stream.write = write;
    Logger.overrideLogger(['log', 'error', 'warn']);
  }

  clear(): void {
    this.lines = [];
  }

  all(): string[] {
    return [...this.lines];
  }

  /** Todo lo capturado, como un solo texto. */
  text(): string {
    return this.lines.join('\n');
  }
}

export interface ConformanceHarness extends HostConformanceHarness {
  /** Tres `GET /conversations` simultáneos: deja al menos dos conexiones abiertas en el pool de Postgres. */
  warmUp(): Promise<void>;
  /** Aborta las peticiones colgadas y cierra las conexiones del cliente; ya no se puede usar. */
  dispose(): void;
}

/**
 * El arnés de conformidad de `@franca/engine/conformance` contra la API y Postgres reales. `sessions(provider)` fija el
 * proveedor guionizado y devuelve las conversaciones por HTTP; `llm(provider)` es la composición de producción
 * (`createAdvanceLlm`, el reloj y el presupuesto de la API) con el proveedor del caso como `principal`.
 */
/** Puerto virtual en el que no escucha nada y que ningún par permitido usa. */
const BLOCKED_PORT = 29_999;
/** Los puertos virtuales de los servidores y las direcciones de TEST-NET-2 (`198.51.100.0/24`: no es global ni está en las internas del motor). */
const FIRST_VIRTUAL_PORT = 21_000;

export function createConversationsHarness(ctx: ConversationsContext, output: ResettableOutput): ConformanceHarness {
  const { llm: scripted, clock, network } = ctx.testApp;
  const servers = new TestServers();
  /** Los pares permitidos del host bajo prueba: `serve()` y `refusing()` añaden el suyo y nada más se permite. */
  const allowed = new Set<string>();
  const secretsByTenant = new Map<string, { secrets: Map<string, InstalledSecret>; store: SecretStore }>();
  let virtualCount = 0;
  const base = `http://127.0.0.1:${ctx.testApp.port}`;
  const pending = new Set<AbortController>();
  const budgetUsd = 0.5;

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const controller = new AbortController();
    pending.add(controller);
    try {
      const init: RequestInit = { method, signal: controller.signal };
      if (body !== undefined) Object.assign(init, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const response = await fetch(`${base}${path}`, init);
      return { status: response.status, json: await response.json().catch(() => undefined) };
    } finally {
      pending.delete(controller);
    }
  };

  const sessions = (provider: LlmCapability): ConformanceSessions => {
    scripted.use((request) => provider(request));
    return {
      async start(flow) {
        const { id: flowId } = flow as { id: string };
        const created = await call('POST', '/flows', flow);
        const published = await call('POST', `/flows/${flowId}/versions`);
        const conversation = await call('POST', '/conversations', { flowId });
        if (created.status !== 201 || published.status !== 201 || conversation.status !== 201) {
          throw new Error(`no se pudo arrancar la sesión (${created.status}, ${published.status}, ${conversation.status})`);
        }
        return { id: conversation.json.conversation.id as string };
      },
      async continue(id, input, clientState) {
        const response = await call('POST', `/conversations/${id}/inputs`, { input, state: clientState });
        if (response.status === 200) return { kind: 'applied', status: response.json.conversation.status as SessionStatus };
        if (response.status === 409 && response.json?.error === 'conversation_busy') return { kind: 'conflict' };
        throw new Error(`la continuación respondió ${response.status}`);
      },
      async expireClaims() {
        clock.advance(CLAIM_TTL_MS);
      },
    };
  };

  /** El almacén de un tenant, creado junto a su mapa: cada tenant tiene el suyo desde que existe. */
  const tenantOf = (tenant: string): { secrets: Map<string, InstalledSecret>; store: SecretStore } => {
    const known = secretsByTenant.get(tenant);
    if (known) return known;
    const secrets = new Map<string, InstalledSecret>();
    const created = { secrets, store: createSecretStore(secrets) };
    secretsByTenant.set(tenant, created);
    return created;
  };

  /** El `http` de producción para un tenant: la salida http de la API con el resolutor, los permitidos, los secretos y el registro del arnés. */
  const http = (tenant = 'default'): HttpCapability =>
    createHttpHost({
      secrets: tenantOf(tenant).store,
      allowed,
      network,
      notices: createLoggerNotices(new Logger('HttpHost')),
    }).forAdvance({ conversationId: 'conformancia', deadlineMs: Date.now() + 90_000, now: () => Date.now() });

  /** Una dirección y un puerto virtuales nuevos, y su par añadido a los permitidos. */
  const allocate = (): { address: string; port: number; name: string; index: number } => {
    virtualCount += 1;
    const address = `198.51.100.${virtualCount}`;
    const port = FIRST_VIRTUAL_PORT + virtualCount;
    allowed.add(destinationKey(address, port)!);
    return { address, port, name: `srv-${virtualCount}.conformance.test`, index: virtualCount };
  };

  const serve = async (behaviour: ServerBehaviour, options: ServeOptions = {}): Promise<ConformanceServer> => {
    const { address, port, name } = allocate();
    const tls = options.tls ?? 'none';
    const server = await servers.start(behaviour, tls === 'none' ? {} : { tls: { hostname: name, authority: tls === 'trusted' ? 'trusted' : 'untrusted' } });
    network.resolve(name, [address]);
    network.mapPair(address, port, server);
    return { origin: `${tls === 'none' ? 'http' : 'https'}://${name}:${port}`, address, port, received: async () => server.received() };
  };

  const refusing = async (): Promise<{ origin: string; address: string; port: number }> => {
    const { address, port, index } = allocate();
    const name = `refuse-${index}.conformance.test`;
    network.resolve(name, [address]);
    return { origin: `http://${name}:${port}`, address, port };
  };

  return {
    http,
    serve,
    resolve: async (name, answers) => network.resolve(name, ...answers),
    blockedPort: BLOCKED_PORT,
    refusing,
    connectionsTo: async (): Promise<readonly Connection[]> => network.connections().map(({ address, port }) => ({ address, port })),
    setSecret: async (name, value, origins, tenant = 'default') => {
      tenantOf(tenant).secrets.set(name, { value, origins: new Set(origins) });
    },
    llm: (provider) =>
      createAdvanceLlm({
        providers: new Map([['principal', provider]]),
        now: () => clock.now().getTime(),
        startedAtMs: clock.now().getTime(),
        budgetUsd,
        priorCostUsd: 0,
      }).capability,
    sessions,
    logs: async () => output.all(),
    now: () => Date.now(),
    // La tolerancia del entorno del catálogo de conformidad del motor.
    timeToleranceMs: 1500,
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('espera cancelada'));
        });
      }),
    async reset() {
      pending.forEach((controller) => controller.abort());
      pending.clear();
      await servers.closeAll();
      await network.reset();
      allowed.clear();
      secretsByTenant.clear();
      virtualCount = 0;
      await resetConversations(ctx.prisma);
      scripted.reset();
      clock.reset();
      output.clear();
    },
    async warmUp() {
      await Promise.all([ctx.conv.list(), ctx.conv.list(), ctx.conv.list()]);
    },
    dispose() {
      pending.forEach((controller) => controller.abort());
      pending.clear();
      void servers.closeAll();
    },
  };
}
