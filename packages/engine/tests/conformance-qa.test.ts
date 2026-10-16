import { describe, expect, it } from 'vitest';
import { HOST_CONFORMANCE_CASES } from '../src/conformance/index.js';
import type { ConformanceSessions, HostConformanceHarness } from '../src/conformance/types.js';
import { continueSession, createLlmCapability, startSession, type EngineHost, type LlmCapability, type LlmTurnRequest, type SessionState, type SessionStatus } from '../src/index.js';

/**
 * QA independiente de los casos de conformidad de llm: un host de producción mínimo, escrito aparte
 * del que usa el catálogo, con defectos distintos y parciales. El conforme pasa los cuatro casos; cada
 * defecto que la suite debe vigilar falla el suyo. Los que la suite NO vigila hoy quedan como
 * `it.fails`; cuando el caso los cubrió, pasaron a `it`.
 */

type Defect =
  | null
  | 'log-system'
  | 'log-goal'
  | 'log-result-text'
  | 'log-result-slots'
  | 'log-last-history'
  | 'log-only-when-the-provider-fails'
  | 'serialize-instead-of-conflict'
  | 'check-after-running'
  | 'claim-never-expires'
  | 'expire-loses-the-state'
  | 'client-cost-only';

interface Entry {
  flow: unknown;
  state: SessionState;
  claimed: boolean;
  chain: Promise<unknown>;
}

class MiniHost {
  readonly lines: string[] = [];
  private readonly sessionsById = new Map<string, Entry>();
  private nextId = 0;

  constructor(private readonly defect: Defect) {}

  /** La capacidad llm: enruta por nombre y registra; los defectos registran de más. */
  llm(provider: LlmCapability): LlmCapability {
    const routed = createLlmCapability({ principal: provider });
    return async (request: LlmTurnRequest) => {
      this.logRequest(request);
      try {
        const result = await routed(request);
        this.logResult(result);
        return result;
      } catch (error) {
        if (this.defect === 'log-only-when-the-provider-fails') this.lines.push(`llm falló ${JSON.stringify(request.history)}`);
        throw error;
      }
    };
  }

  private logRequest(request: LlmTurnRequest): void {
    this.lines.push(`llm nodo=${request.nodeId} proveedor=${request.provider} turno=${request.turn}`);
    if (this.defect === 'log-system') this.lines.push(`llm system=${request.system}`);
    if (this.defect === 'log-goal') this.lines.push(`llm goal=${request.goal}`);
    if (this.defect === 'log-last-history') this.lines.push(`llm último=${request.history.at(-1)?.text}`);
  }

  private logResult(result: unknown): void {
    const turn = result as { kind: string; text?: string; slots?: unknown; costUsd?: number };
    this.lines.push(`llm resultado=${turn.kind} coste=${turn.costUsd}`);
    if (this.defect === 'log-result-text') this.lines.push(`llm texto=${turn.text}`);
    if (this.defect === 'log-result-slots') this.lines.push(`llm slots=${JSON.stringify(turn.slots)}`);
  }

  sessions(provider: LlmCapability): ConformanceSessions {
    const host: EngineHost = { llm: this.llm(provider) };
    return {
      start: async (flow) => {
        const result = await startSession({ flow }, host);
        if (!result.ok) throw new Error('arranque rechazado');
        const id = `sesion-${this.nextId++}`;
        this.sessionsById.set(id, { flow, state: result.state, claimed: false, chain: Promise.resolve() });
        return { id };
      },
      continue: async (id, input, clientState) => {
        const entry = this.sessionsById.get(id);
        if (entry === undefined) throw new Error('sesión desconocida');
        if (this.defect === 'serialize-instead-of-conflict') {
          const run = entry.chain.then(() => this.apply(entry, host, input, clientState));
          entry.chain = run.catch(() => undefined);
          return run;
        }
        if (this.defect === 'check-after-running') {
          const before = entry.state;
          const result = await continueSession({ flow: entry.flow, state: before, input }, host);
          if (entry.state !== before) return { kind: 'conflict' } as const;
          if (result.ok) entry.state = result.state;
          return { kind: 'applied', status: result.ok ? result.status : 'failed' } as const;
        }
        if (entry.claimed) return { kind: 'conflict' } as const;
        entry.claimed = true;
        return this.apply(entry, host, input, clientState);
      },
      expireClaims: async () => {
        if (this.defect === 'claim-never-expires') return;
        if (this.defect === 'expire-loses-the-state') {
          this.sessionsById.clear();
          return;
        }
        for (const entry of this.sessionsById.values()) entry.claimed = false;
      },
    };
  }

  private async apply(entry: Entry, host: EngineHost, input: unknown, clientState: unknown): Promise<{ kind: 'applied'; status: SessionStatus }> {
    let state: SessionState = entry.state;
    if (this.defect === 'client-cost-only' && clientState !== undefined) {
      // Se queda con los mensajes guardados pero acepta el coste que traiga el cliente.
      const forged = (clientState as { conversation?: { costUsd?: number } }).conversation?.costUsd ?? 0;
      state = { ...state, conversation: { ...state.conversation!, costUsd: forged } };
    }
    const result = await continueSession({ flow: entry.flow, state, input }, host);
    if (result.ok) entry.state = result.state;
    entry.claimed = false;
    return { kind: 'applied', status: result.ok ? result.status : 'failed' };
  }

  harness(): HostConformanceHarness {
    return {
      llm: (provider: LlmCapability) => this.llm(provider),
      sessions: (provider: LlmCapability) => this.sessions(provider),
      logs: async () => this.lines,
      sleep: (ms: number, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
      reset: async () => {},
      timeToleranceMs: 300,
      now: () => Date.now(),
    } as unknown as HostConformanceHarness;
  }
}

const LLM_CASES = ['registros-llm', 'custodia-estado', 'una-continuacion', 'reclamacion-caducada'] as const;

/** Los fallos de un caso, o `['la ejecución del caso se rechazó']` si el host defectuoso lo hace reventar. */
async function failuresOf(id: (typeof LLM_CASES)[number], defect: Defect): Promise<string[]> {
  const found = HOST_CONFORMANCE_CASES.find((c) => c.id === id)!;
  try {
    return await found.run(new MiniHost(defect).harness());
  } catch {
    return ['la ejecución del caso se rechazó'];
  }
}

describe('Conformidad de llm: un host conforme pasa los cuatro casos', () => {
  it.each(LLM_CASES)('%s', async (id) => {
    expect(await failuresOf(id, null)).toEqual([]);
  });
});

describe('Conformidad de llm: cada defecto parcial hace fallar el caso que lo vigila', () => {
  it.each([
    ['registros-llm', 'log-system'],
    ['registros-llm', 'log-goal'],
    ['registros-llm', 'log-result-text'],
    ['registros-llm', 'log-result-slots'],
    ['registros-llm', 'log-last-history'],
    ['una-continuacion', 'serialize-instead-of-conflict'],
    ['una-continuacion', 'check-after-running'],
    ['reclamacion-caducada', 'claim-never-expires'],
    ['reclamacion-caducada', 'expire-loses-the-state'],
  ] as const)('%s detecta %s', async (id, defect) => {
    expect((await failuresOf(id, defect)).length).toBeGreaterThan(0);
  });

  it('un defecto que no toca nada que el caso vigile no lo hace fallar (los casos no se rompen por ruido)', async () => {
    expect(await failuresOf('custodia-estado', 'log-system')).toEqual([]);
    expect(await failuresOf('una-continuacion', 'log-goal')).toEqual([]);
  });
});

describe('Conformidad de llm: los defectos existen de verdad (el host conforme no los tiene)', () => {
  const flow = {
    specVersion: '0.1',
    id: 'tope',
    name: 'Tope',
    variables: [{ name: 'email', type: 'email', scope: 'contact', pii: true }],
    start: 'a',
    nodes: [
      { id: 'a', type: 'llm', provider: 'principal', goal: 'g', slots: [{ variable: 'email', description: 'e' }], maxTurns: 10, costCapUsd: 0.025, next: 'ok', onExhausted: 'ko' },
      { id: 'ok', type: 'end', outcome: 'ok' },
      { id: 'ko', type: 'end', outcome: 'ko' },
    ],
  };
  const forged = { conversation: { messages: [{ role: 'assistant', text: 'x' }], costUsd: 0, collected: {} } };

  it('un host que acepta el coste del cliente reinicia el tope de coste; uno conforme no', async () => {
    const calls = async (defect: Defect): Promise<number> => {
      let count = 0;
      const provider: LlmCapability = async () => {
        count++;
        return { kind: 'turn', text: 'sigo', slots: {}, done: false, costUsd: 0.01 };
      };
      const sessions = new MiniHost(defect).sessions(provider);
      const { id } = await sessions.start(flow);
      await sessions.continue(id, { text: 'uno' });
      // Con 0.02 acumulados, el tercer turno llega a 0.03 y agota el tope; el cuarto ya no llama al proveedor.
      await sessions.continue(id, { text: 'dos' }, forged);
      await sessions.continue(id, { text: 'tres' }, forged);
      return count;
    };
    expect(await calls(null)).toBe(3);
    expect(await calls('client-cost-only')).toBeGreaterThan(3);
  });

  it('un host que registra al fallar el proveedor deja el historial en sus registros', async () => {
    const host = new MiniHost('log-only-when-the-provider-fails');
    const failing: LlmCapability = async () => {
      throw new Error('proveedor caído');
    };
    const request: LlmTurnRequest = { nodeId: 'a', provider: 'principal', model: null, system: null, goal: 'g', slots: [], history: [{ role: 'assistant', text: 'MARCA-FALLO' }], temperature: null, locale: 'es', turn: 2, maxTurns: 8 };
    await expect(host.llm(failing)(request)).rejects.toThrow();
    expect(host.lines.join('\n')).toContain('MARCA-FALLO');
  });
});

describe('Conformidad de llm: lo que antes no vigilaban los casos', () => {
  // Antes GAP (Medio): el caso solo miraba el turno y el historial. Ahora usa un flujo con costCapUsd.
  it('custodia-estado detecta un host que acepta el coste que aporta el cliente', async () => {
    expect((await failuresOf('custodia-estado', 'client-cost-only')).length).toBeGreaterThan(0);
  });

  // Antes GAP (Bajo): el caso solo probaba el camino en que el proveedor resuelve. Ahora prueba también los fallos.
  it('registros-llm detecta un host que registra el historial cuando el proveedor falla', async () => {
    expect((await failuresOf('registros-llm', 'log-only-when-the-provider-fails')).length).toBeGreaterThan(0);
  });
});
