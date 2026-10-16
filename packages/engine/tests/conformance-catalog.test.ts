import { describe, expect, it } from 'vitest';
import { HOST_CONFORMANCE_CASES } from '../src/conformance/index.js';
import type {
  ConformanceSessions,
  Connection,
  ConformanceServer,
  HostConformanceHarness,
  ReceivedRequest,
  ServeOptions,
  ServerBehaviour,
} from '../src/conformance/types.js';
import {
  continueSession,
  createLlmCapability,
  startSession,
  type HttpAttemptResult,
  type HttpCapability,
  type HttpRequest,
  type LlmCapability,
  type SessionState,
} from '../src/index.js';

/**
 * Un host y un arnés en memoria, sin red ni reloj simulado, que cumplen el contrato «Host de producción».
 * Sirven para dos cosas que el catálogo no prueba por sí solo: que cada caso se puede satisfacer (un
 * host conforme pasa los 21) y que cada caso discrimina (cada defecto de `Defects` hace fallar al
 * caso que lo vigila). El host falso decide con la lista de pares permitidos, como el real.
 */
type Defect =
  | 'follow-redirects'
  | 'keep-cookies'
  | 'secret-any-origin'
  | 'secret-any-tenant'
  | 'rebind-to-loopback'
  | 'mixed-fallback'
  | 'allow-all-destinations'
  | 'log-pii'
  | 'log-secret'
  | 'trust-any-certificate'
  | 'tls-error-after-send'
  | 'refused-after-send'
  | 'no-body-limit'
  | 'wire-limit-only'
  | 'late-timeout'
  | 'early-timeout'
  | 'result-has-secret'
  | 'reject-on-error'
  | 'log-llm'
  | 'trust-client-state'
  | 'no-claim'
  | 'claim-never-expires';

const TOLERANCE = 300;
const MIB = 1048576;

class FakeNetwork {
  private servers = new Map<string, { behaviour: ServerBehaviour; tls: NonNullable<ServeOptions['tls']>; received: ReceivedRequest[] }>();
  private allowed = new Set<string>();
  private dns = new Map<string, { rounds: string[][]; used: number }>();
  private secrets = new Map<string, { value: string; origins: string[] }>();
  private jar: string[] = [];
  connections: Connection[] = [];
  logLines: string[] = [];
  private next = 1;
  private nextSession = 1;
  private sessionStore = new Map<string, { flow: unknown; state: SessionState; claimed: boolean }>();
  readonly blockedPort = 9;

  constructor(private readonly defect?: Defect) {}

  private key = (address: string, port: number): string => `${address}|${port}`;

  harness(): HostConformanceHarness {
    const net = this;
    return {
      http: (tenant = 'default'): HttpCapability => (request) => net.fetch(request, tenant) as Promise<HttpAttemptResult>,
      async serve(behaviour, options = {}) {
        const id = net.next++;
        const address = `203.0.113.${id}`;
        const port = 41000 + id;
        const tls = options.tls ?? 'none';
        const name = `srv-${id}.conformance.test`;
        net.servers.set(net.key(address, port), { behaviour, tls, received: [] });
        net.allowed.add(net.key(address, port));
        net.dns.set(name, { rounds: [[address]], used: 0 });
        const origin = `${tls === 'none' ? 'http' : 'https'}://${name}:${port}`;
        const server: ConformanceServer = {
          origin,
          address,
          port,
          received: async () => net.servers.get(net.key(address, port))!.received,
        };
        return server;
      },
      async resolve(name, answers) {
        net.dns.set(name, { rounds: answers.map((round) => [...round]), used: 0 });
      },
      blockedPort: net.blockedPort,
      async refusing() {
        const id = net.next++;
        const address = `203.0.113.${id}`;
        const port = 42000 + id;
        net.allowed.add(net.key(address, port));
        net.dns.set(`refused-${id}.conformance.test`, { rounds: [[address]], used: 0 });
        return { origin: `http://refused-${id}.conformance.test:${port}`, address, port };
      },
      async connectionsTo() {
        return net.connections;
      },
      llm: (provider) => net.llm(provider),
      sessions: (provider) => net.sessions(provider),
      async setSecret(name, value, origins, tenant = 'default') {
        net.secrets.set(`${tenant}|${name}`, { value, origins: [...origins] });
      },
      async logs() {
        return net.logLines;
      },
      now: () => Date.now(),
      timeToleranceMs: TOLERANCE,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      async reset() {
        net.connections = [];
        net.logLines = [];
      },
    };
  }

  /** La capacidad llm del host: enruta por nombre y registra sin datos (o con ellos, con el defecto `log-llm`). */
  private llm(provider: LlmCapability): LlmCapability {
    const route = createLlmCapability({ principal: provider });
    return async (request) => {
      if (this.defect === 'log-llm') this.logLines.push(`llm ${JSON.stringify(request)}`);
      else this.logLines.push(`llm ${request.nodeId} ${request.provider} ${request.model ?? '-'} turn ${request.turn}`);
      const result = await route(request);
      if (this.defect === 'log-llm') this.logLines.push(`llm resultado ${JSON.stringify(result)}`);
      else this.logLines.push(`llm resultado ${result.kind}`);
      return result;
    };
  }

  /** La API de sesiones del host: custodia el estado y reclama antes de ejecutar el motor, salvo los defectos. */
  private sessions(provider: LlmCapability): ConformanceSessions {
    const host = { llm: this.llm(provider) };
    return {
      start: async (flow) => {
        const result = await startSession({ flow }, host);
        if (!result.ok) throw new Error('el flujo de la suite debe ser válido');
        const id = `sesion-${this.nextSession++}`;
        this.sessionStore.set(id, { flow, state: result.state, claimed: false });
        return { id };
      },
      continue: async (id, input, clientState) => {
        const entry = this.sessionStore.get(id)!;
        if (this.defect !== 'no-claim') {
          if (entry.claimed) return { kind: 'conflict' };
          entry.claimed = true;
        }
        const state = this.defect === 'trust-client-state' && clientState !== undefined ? clientState : entry.state;
        const result = await continueSession({ flow: entry.flow, state, input }, host);
        if (!result.ok) throw new Error('la continuación de la suite debe aceptarse');
        entry.state = result.state;
        entry.claimed = false;
        return { kind: 'applied' };
      },
      expireClaims: async () => {
        if (this.defect === 'claim-never-expires') return;
        for (const entry of this.sessionStore.values()) entry.claimed = false;
      },
    };
  }

  private resolveName(host: string): string[] {
    const entry = this.dns.get(host);
    if (!entry) return [];
    const round = entry.rounds[Math.min(entry.used, entry.rounds.length - 1)]!;
    entry.used++;
    return round;
  }

  private async fetch(request: HttpRequest, tenant: string): Promise<unknown> {
    const url = new URL(request.url);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const log = (line: string): void => void this.logLines.push(line);
    if (this.defect === 'log-pii' || this.defect === 'log-secret') log(`GET ${request.url} ${request.body ?? ''}`);
    else log(`${request.nodeId} ${request.method} ${url.origin} #${request.attempt}`);

    const headers: Record<string, string> = {};
    for (const header of request.headers) {
      if ('value' in header) {
        headers[header.name.toLowerCase()] = header.value;
        continue;
      }
      const secret = this.secrets.get(`${this.defect === 'secret-any-tenant' ? 'default' : tenant}|${header.secret}`) ?? (this.defect === 'secret-any-tenant' ? [...this.secrets.values()][0] : undefined);
      if (!secret || (this.defect !== 'secret-any-origin' && !secret.origins.includes(url.origin))) return { kind: 'missing_secret' };
      headers[header.name.toLowerCase()] = secret.value;
      if (this.defect === 'log-secret') log(`Authorization: ${secret.value}`);
    }

    const addresses = this.resolveName(url.hostname);
    const permitted = addresses.filter((address) => this.allowed.has(this.key(address, port)));
    let targets = permitted;
    if (this.defect === 'allow-all-destinations') targets = addresses;
    else if (this.defect === 'rebind-to-loopback') targets = addresses;
    else if (this.defect === 'mixed-fallback') targets = addresses.length > 0 ? addresses : permitted;
    if (targets.length === 0) return { kind: 'blocked' };

    // Se prueban en orden; el defecto «mixed-fallback» salta al siguiente si el primero rechaza.
    for (const address of targets) {
      this.connections.push({ address, port });
      const server = this.servers.get(this.key(address, port));
      if (!server) {
        if (this.defect === 'mixed-fallback' && targets.length > 1) continue;
        return { kind: 'network_error', requestSent: this.defect === 'refused-after-send' };
      }
      if (url.protocol === 'https:' && server.tls === 'untrusted' && this.defect !== 'trust-any-certificate') {
        return { kind: 'network_error', requestSent: this.defect === 'tls-error-after-send' };
      }
      const cookie: Record<string, string> = this.defect === 'keep-cookies' && this.jar.length > 0 ? { cookie: this.jar.join('; ') } : {};
      server.received.push({ method: request.method, path: `${url.pathname}${url.search}`, headers: { ...headers, ...cookie }, body: request.body ?? '' });
      return this.respond(server.behaviour, request, url);
    }
    return { kind: 'blocked' };
  }

  private async respond(behaviour: ServerBehaviour, request: HttpRequest, url: URL): Promise<unknown> {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const timeout = async (): Promise<unknown> => {
      const extra = this.defect === 'late-timeout' ? TOLERANCE + 200 : this.defect === 'early-timeout' ? -200 : 0;
      await wait(request.timeoutMs + extra);
      return { kind: 'timeout' };
    };
    switch (behaviour.kind) {
      case 'respond':
        return { kind: 'response', status: behaviour.status, body: behaviour.body ?? '' };
      case 'redirect':
        if (this.defect === 'follow-redirects') {
          const target = new URL(behaviour.location, url);
          for (const [key, server] of this.servers) {
            if (key.endsWith(`|${target.port}`)) {
              server.received.push({ method: 'GET', path: target.pathname, headers: {}, body: '' });
              return { kind: 'response', status: 200, body: '' };
            }
          }
          this.connections.push({ address: target.hostname, port: Number(target.port) });
          return { kind: 'network_error', requestSent: false };
        }
        return { kind: 'response', status: behaviour.status, body: '' };
      case 'set-cookie':
        this.jar.push(behaviour.cookie);
        return { kind: 'response', status: 200, body: '' };
      case 'endless-body':
        if (this.defect === 'no-body-limit') return { kind: 'response', status: 200, body: 'a'.repeat(MIB + 10) }; // acumula sin límite
        return { kind: 'response_too_large' };
      case 'compressed-body':
        if (this.defect === 'wire-limit-only') return { kind: 'response', status: 200, body: 'a'.repeat(behaviour.decompressedBytes) };
        return behaviour.decompressedBytes > MIB ? { kind: 'response_too_large' } : { kind: 'response', status: 200, body: 'a'.repeat(behaviour.decompressedBytes) };
      case 'stall-headers':
      case 'stall-body':
      case 'drip-body':
        return timeout();
    }
  }
}

const CASE = (id: string) => HOST_CONFORMANCE_CASES.find((c) => c.id === id)!;
const FAST = HOST_CONFORMANCE_CASES.filter((c) => !['servidor-a-medias', 'servidor-no-responde', 'servidor-muy-lento'].includes(c.id));
const TIMING = HOST_CONFORMANCE_CASES.filter((c) => ['servidor-a-medias', 'servidor-no-responde', 'servidor-muy-lento'].includes(c.id));

async function run(id: string, defect?: Defect): Promise<string[]> {
  const net = new FakeNetwork(defect);
  return CASE(id).run(net.harness());
}

describe('un host conforme pasa los 21 casos (cada caso se puede satisfacer)', () => {
  it.each(FAST.map((c) => [c.id] as const))('%s', async (id) => {
    expect(await run(id)).toEqual([]);
  });

  it.each(TIMING.map((c) => [c.id] as const))('%s (tiempo real: 500 ms)', async (id) => {
    expect(await run(id)).toEqual([]);
  });
});

describe('cada defecto de un host hace fallar al caso que lo vigila (los casos discriminan)', () => {
  it.each<[Defect, string]>([
    ['follow-redirects', 'redireccion'],
    ['keep-cookies', 'cookies'],
    ['secret-any-origin', 'secreto-origen-no-autorizado'],
    ['secret-any-tenant', 'secreto-otro-tenant'],
    ['allow-all-destinations', 'destinos-internos'],
    ['rebind-to-loopback', 'cambio-de-resolucion'],
    ['mixed-fallback', 'resolucion-mezclada'],
    ['log-pii', 'registros-pii'],
    ['log-secret', 'secreto-a-su-origen'],
    ['trust-any-certificate', 'tls-invalido'],
    ['tls-error-after-send', 'tls-invalido'],
    ['refused-after-send', 'conexion-rechazada'],
    ['no-body-limit', 'cuerpo-sin-fin'],
    ['no-body-limit', 'cuerpo-comprimido-sin-fin'],
    ['wire-limit-only', 'bomba-descompresion'],
    ['log-llm', 'registros-llm'],
    ['trust-client-state', 'custodia-estado'],
    ['no-claim', 'una-continuacion'],
    ['claim-never-expires', 'reclamacion-caducada'],
  ])('%s → %s', async (defect, id) => {
    const failures = await run(id, defect);
    expect(failures.length, `${defect} debía hacer fallar a ${id}`).toBeGreaterThan(0);
  });

  it('un timeout tardío o temprano falla los casos de tiempo', async () => {
    expect((await run('servidor-no-responde', 'late-timeout')).length).toBeGreaterThan(0);
    expect((await run('servidor-no-responde', 'early-timeout')).length).toBeGreaterThan(0);
  });

  it('los fallos no incluyen el valor del secreto ni los datos personales del arnés', async () => {
    const all = [...(await run('secreto-a-su-origen', 'log-secret')), ...(await run('registros-pii', 'log-pii')), ...(await run('secreto-origen-no-autorizado', 'secret-any-origin'))];
    expect(all.length).toBeGreaterThan(0);
    for (const failure of all) {
      expect(failure).not.toContain('ZQXJ');
      expect(failure).not.toContain('@example.com');
    }
  });
});

describe('los casos de llm', () => {
  it('los fallos no incluyen los marcadores ni los datos personales del arnés', async () => {
    const all = [
      ...(await run('registros-llm', 'log-llm')),
      ...(await run('custodia-estado', 'trust-client-state')),
      ...(await run('una-continuacion', 'no-claim')),
      ...(await run('reclamacion-caducada', 'claim-never-expires')),
    ];
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const failure of all) {
      expect(failure).not.toContain('ZQXJ7LLM');
      expect(failure.toLowerCase()).not.toContain('zqxj-llm-pii');
    }
  });

  it('un proveedor que se rechaza o devuelve algo fuera de contrato anota un fallo y el caso no rechaza', async () => {
    const net = new FakeNetwork();
    const harness = net.harness();
    const rejecting = { ...harness, llm: () => (async () => Promise.reject(new Error('ZQXJ7LLMHIST'))) as unknown as LlmCapability };
    const malformed = { ...harness, llm: () => (async () => ({ kind: 'otro' })) as unknown as LlmCapability };
    for (const broken of [rejecting, malformed]) {
      const failures = await CASE('registros-llm').run(broken);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.join()).not.toContain('ZQXJ7LLMHIST');
    }
  });
});

