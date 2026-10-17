import { Logger } from '@nestjs/common';
import type { LlmCapability, LlmTurnRequest, LlmTurnResult } from '@franca/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdvanceLlm, type AdvanceLlmOptions } from './advance-llm.js';

const request = (provider = 'principal'): LlmTurnRequest => ({
  nodeId: 'a',
  provider,
  model: null,
  system: null,
  goal: 'Saluda.',
  slots: [],
  history: [],
  temperature: null,
  locale: 'es',
  turn: 1,
  maxTurns: 8,
});

const turn = (costUsd: number): LlmTurnResult => ({ kind: 'turn', text: 'Hola', slots: {}, done: false, costUsd });

interface Setup {
  calls: LlmTurnRequest[];
  advance: ReturnType<typeof createAdvanceLlm>;
  clock: { ms: number };
}

function setup(result: LlmTurnResult | (() => Promise<LlmTurnResult>), overrides: Partial<AdvanceLlmOptions> = {}): Setup {
  const calls: LlmTurnRequest[] = [];
  const clock = { ms: 1_000 };
  const provider: LlmCapability = async (req) => {
    calls.push(req);
    return typeof result === 'function' ? result() : result;
  };
  const advance = createAdvanceLlm({
    providers: new Map([['principal', provider]]),
    now: () => clock.ms,
    startedAtMs: 1_000,
    budgetUsd: 0.5,
    priorCostUsd: 0,
    ...overrides,
  });
  return { calls, advance, clock };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAdvanceLlm', () => {
  it('un proveedor desconocido da not_configured sin llamar ni consumir presupuesto ni plazo', async () => {
    const { advance, calls, clock } = setup(turn(0.01), { budgetUsd: 0.01, priorCostUsd: 5 });
    clock.ms += 10_000_000;
    expect(await advance.capability(request('barato'))).toEqual({ kind: 'not_configured' });
    expect(await advance.capability(request('constructor'))).toEqual({ kind: 'not_configured' });
    expect(await advance.capability(request('__proto__'))).toEqual({ kind: 'not_configured' });
    expect(calls).toEqual([]);
    expect(advance.spentUsd()).toBe(0);
    expect(advance.limitReached()).toBe(false);
  });

  it('el plazo: a 89 999 ms llama al proveedor y a 90 000 ms no', async () => {
    const early = setup(turn(0.01));
    early.clock.ms = 1_000 + 89_999;
    expect((await early.advance.capability(request())).kind).toBe('turn');
    expect(early.calls).toHaveLength(1);

    const late = setup(turn(0.01));
    late.clock.ms = 1_000 + 90_000;
    expect(await late.advance.capability(request())).toEqual({ kind: 'failed', costUsd: 0 });
    expect(late.calls).toHaveLength(0);
    expect(late.advance.limitReached()).toBe(false);
  });

  it('el presupuesto: >= bloquea, marca limitReached y no llama', async () => {
    const { advance, calls } = setup(turn(0.01), { budgetUsd: 0.02 });
    expect((await advance.capability(request())).kind).toBe('turn');
    expect(advance.limitReached()).toBe(false);
    expect((await advance.capability(request())).kind).toBe('turn');
    expect(advance.spentUsd()).toBeCloseTo(0.02, 12);
    expect(await advance.capability(request())).toEqual({ kind: 'failed', costUsd: 0 });
    expect(calls).toHaveLength(2);
    expect(advance.limitReached()).toBe(true);
    expect(advance.spentUsd()).toBeCloseTo(0.02, 12);
  });

  it('el presupuesto cuenta el coste previo de la conversación', async () => {
    const blocked = setup(turn(0.01), { budgetUsd: 0.02, priorCostUsd: 0.02 });
    expect(await blocked.advance.capability(request())).toEqual({ kind: 'failed', costUsd: 0 });
    expect(blocked.advance.limitReached()).toBe(true);
    expect(blocked.calls).toHaveLength(0);

    const allowed = setup(turn(0.01), { budgetUsd: 0.02, priorCostUsd: 0.01 });
    expect((await allowed.advance.capability(request())).kind).toBe('turn');
    expect(allowed.advance.limitReached()).toBe(false);
  });

  it('con un presupuesto antes que el plazo no marca limitReached si el plazo ya venció', async () => {
    const { advance, clock } = setup(turn(0.01), { budgetUsd: 0.01, priorCostUsd: 1 });
    clock.ms += 90_000;
    expect(await advance.capability(request())).toEqual({ kind: 'failed', costUsd: 0 });
    expect(advance.limitReached()).toBe(false);
  });

  it.each([
    ['turn', { kind: 'turn', text: 'x', slots: {}, done: true, costUsd: 0.25 }, 0.25],
    ['refusal', { kind: 'refusal', costUsd: 0.25 }, 0.25],
    ['failed', { kind: 'failed', costUsd: 0.25 }, 0.25],
    ['not_configured con costUsd', { kind: 'not_configured', costUsd: 0.25 }, 0],
    ['kind desconocido', { kind: 'otra', costUsd: 0.25 }, 0],
    ['coste NaN', { kind: 'failed', costUsd: Number.NaN }, 0],
    ['coste infinito', { kind: 'failed', costUsd: Number.POSITIVE_INFINITY }, 0],
    ['coste negativo', { kind: 'failed', costUsd: -1 }, 0],
    ['coste texto', { kind: 'failed', costUsd: '0.25' }, 0],
    ['sin coste', { kind: 'failed' }, 0],
    ['coste 0', { kind: 'failed', costUsd: 0 }, 0],
  ])('suma solo costes finitos >= 0 de resultados facturables: %s', async (_name, result, expected) => {
    const { advance } = setup(result as LlmTurnResult);
    await advance.capability(request());
    expect(advance.spentUsd()).toBe(expected);
  });

  it('devuelve el resultado del proveedor tal cual, aunque no sea válido', async () => {
    const odd = { kind: 'turn', text: 5, slots: null, done: 'sí', costUsd: 0.1 } as unknown as LlmTurnResult;
    const { advance } = setup(odd);
    expect(await advance.capability(request())).toBe(odd);
    // El coste se cuenta: el proveedor dice que lo gastó (residual documentado en D8).
    expect(advance.spentUsd()).toBeCloseTo(0.1, 12);
  });

  it('lee kind y costUsd una sola vez', async () => {
    let reads = 0;
    const counted = {
      get kind() {
        reads += 1;
        return 'turn';
      },
      get costUsd() {
        reads += 1;
        return 0.1;
      },
      text: 't',
      slots: {},
      done: true,
    };
    const { advance } = setup(counted as unknown as LlmTurnResult);
    await advance.capability(request());
    expect(reads).toBe(2);
  });

  it('un resultado cuya lectura lanza no suma y no rompe el avance', async () => {
    const hostile = new Proxy(
      {},
      {
        get: (_target, key) => {
          // `then` se lee al resolver la promesa del proveedor; lo que se vigila son `kind` y `costUsd`.
          if (key === 'then') return undefined;
          throw new Error('no se puede leer');
        },
      },
    );
    const { advance } = setup(hostile as unknown as LlmTurnResult);
    expect(await advance.capability(request())).toBe(hostile);
    expect(advance.spentUsd()).toBe(0);
  });

  it('un resultado que no es un objeto no suma', async () => {
    const { advance } = setup(undefined as unknown as LlmTurnResult);
    expect(await advance.capability(request())).toBeUndefined();
    expect(advance.spentUsd()).toBe(0);
  });

  it('un proveedor que rechaza propaga el rechazo y no suma', async () => {
    const failure = new Error('el proveedor se cayó');
    const { advance } = setup(() => Promise.reject(failure));
    await expect(advance.capability(request())).rejects.toBe(failure);
    expect(advance.spentUsd()).toBe(0);
  });

  it('no registra nada en ningún camino', async () => {
    const spies = (['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).flatMap((level) => [vi.spyOn(Logger.prototype, level), vi.spyOn(Logger, level)]);
    const consoleSpies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((level) => vi.spyOn(console, level));
    const written = [vi.spyOn(process.stdout, 'write'), vi.spyOn(process.stderr, 'write')];
    const ok = setup(turn(0.1), { budgetUsd: 0.1 });
    await ok.advance.capability(request());
    await ok.advance.capability(request());
    await ok.advance.capability(request('otro'));
    const boom = setup(() => Promise.reject(new Error('x')));
    await boom.advance.capability(request()).catch(() => undefined);
    for (const spy of [...spies, ...consoleSpies, ...written]) expect(spy).not.toHaveBeenCalled();
  });

  it('cada avance tiene sus contadores', async () => {
    const first = setup(turn(0.2));
    const second = setup(turn(0.2));
    await first.advance.capability(request());
    expect(first.advance.spentUsd()).toBeCloseTo(0.2, 12);
    expect(second.advance.spentUsd()).toBe(0);
  });
});
