import { Logger, type LoggerService } from '@nestjs/common';
import type { ConformanceSessions, HostConformanceHarness } from '@franca/engine/conformance';
import type { LlmCapability, SessionStatus } from '@franca/engine';
import { createAdvanceLlm } from '../../src/conversations/advance-llm.js';
import { CLAIM_TTL_MS } from '../../src/conversations/conversation-timing.js';
import { resetConversations, type ConversationsContext } from './conversations.js';

const NOT_IN_THIS_FEATURE = 'fuera de esta feature: el host http de producción es la feature 6b';

/** Salida de registro que se puede vaciar: el logger de Nest y lo que se escribe en `stdout`/`stderr`. */
export class ResettableOutput {
  private lines: string[] = [];
  readonly logger: LoggerService;
  private readonly originalWrites: { stream: NodeJS.WriteStream; write: NodeJS.WriteStream['write'] }[] = [];

  constructor() {
    const push =
      (level: string) =>
      (message: unknown, ...rest: unknown[]) => {
        const parts = [message, ...rest].filter((part) => part !== undefined && part !== '');
        this.lines.push(`${level} ${parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')}`);
      };
    this.logger = { log: push('log'), error: push('error'), warn: push('warn'), debug: push('debug'), verbose: push('verbose') };
  }

  /** Empieza a capturar: sustituye el logger estático de Nest y las escrituras en `stdout`/`stderr`. */
  install(): void {
    Logger.overrideLogger(this.logger);
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
    for (const { stream, write } of this.originalWrites.splice(0)) stream.write = write;
    Logger.overrideLogger(['log', 'error', 'warn']);
  }

  clear(): void {
    this.lines = [];
  }

  all(): string[] {
    return [...this.lines];
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
export function createConversationsHarness(ctx: ConversationsContext, output: ResettableOutput): ConformanceHarness {
  const { llm: scripted, clock } = ctx.testApp;
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

  const unsupported = (): never => {
    throw new Error(NOT_IN_THIS_FEATURE);
  };

  return {
    http: unsupported,
    serve: unsupported,
    resolve: unsupported,
    blockedPort: 0,
    refusing: unsupported,
    connectionsTo: unsupported,
    setSecret: unsupported,
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
    timeToleranceMs: 250,
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
    },
  };
}
