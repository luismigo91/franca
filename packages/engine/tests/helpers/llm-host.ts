import { expect } from 'vitest';
import type { EngineHost, HttpRequest, LlmCapability, LlmTurnRequest } from '../../src/index.js';

/** Valor a resolver, o función (puede lanzar o devolver una promesa). */
export type LlmStep = unknown | ((request: LlmTurnRequest, index: number) => unknown);

export interface ScriptedLlm {
  llm: LlmCapability;
  host: EngineHost;
  /** `structuredClone` de cada petición en el momento de la llamada: un host que muta la suya no altera el registro. */
  requests: LlmTurnRequest[];
  /** Llamadas en curso a la vez, para «Turnos en secuencia». */
  readonly maxInFlight: number;
  /** Llamadas de más sobre el guion (todo test lo exige a 0 con `expectLlmScript`). */
  readonly overrun: number;
}

/**
 * Proveedor `llm` falso programable, sin red ni reloj: cada llamada resuelve el siguiente paso del
 * guion. Un paso es el valor a resolver o una función `(request, index)` (puede mutar la petición,
 * lanzar o devolver una promesa).
 */
export function scriptedLlm(steps: readonly LlmStep[], options: { repeatLast?: boolean } = {}): ScriptedLlm {
  const requests: LlmTurnRequest[] = [];
  let inFlight = 0;
  const state = { maxInFlight: 0, overrun: 0 };
  let index = 0;
  const llm = async (request: LlmTurnRequest): Promise<unknown> => {
    requests.push(structuredClone(request));
    const at = index++;
    inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    try {
      const overran = at >= steps.length;
      if (overran && !(options.repeatLast && steps.length > 0)) {
        state.overrun++;
        return { kind: 'failed', costUsd: 0 };
      }
      const step = steps[Math.min(at, steps.length - 1)];
      return typeof step === 'function' ? await step(request, at) : step;
    } finally {
      inFlight--;
    }
  };
  return {
    llm: llm as LlmCapability,
    host: { llm: llm as LlmCapability },
    requests,
    get maxInFlight() {
      return state.maxInFlight;
    },
    get overrun() {
      return state.overrun;
    },
  };
}

/** Un `turn` válido. */
export const turn = (text: string, slots: Record<string, unknown> = {}, done = false, costUsd = 0.01) =>
  ({ kind: 'turn', text, slots, done, costUsd }) as const;
export const refusal = (costUsd = 0) => ({ kind: 'refusal', costUsd }) as const;
export const failed = (costUsd = 0) => ({ kind: 'failed', costUsd }) as const;
export const notConfigured = { kind: 'not_configured' } as const;

/** Un proveedor que resuelve siempre lo mismo. */
export const alwaysLlm = (step: LlmStep): ScriptedLlm => scriptedLlm([step], { repeatLast: true });

/** Afirma que el guion no se desbordó y, si se indica, el número de llamadas. */
export function expectLlmScript(h: ScriptedLlm, calls?: number): void {
  expect(h.overrun, 'llamadas de más sobre el guion').toBe(0);
  if (calls !== undefined) expect(h.requests, 'llamadas al proveedor llm').toHaveLength(calls);
}

/** Una llamada de un host con ambas capacidades, en el orden en que ocurrió. */
export type RecordedCall = { capability: 'http'; request: HttpRequest } | { capability: 'llm'; request: LlmTurnRequest };

/**
 * Une las capacidades de varios hosts en uno y registra, en un único orden, las llamadas a `http` y
 * a `llm` (copias hechas en el momento de la llamada).
 */
export function withHosts(...parts: EngineHost[]): { host: EngineHost; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const host: EngineHost = {};
  for (const part of parts) {
    const { http, llm } = part;
    if (http) {
      host.http = (request) => {
        calls.push({ capability: 'http', request: structuredClone(request) });
        return http(request);
      };
    }
    if (llm) {
      host.llm = (request) => {
        calls.push({ capability: 'llm', request: structuredClone(request) });
        return llm(request);
      };
    }
  }
  return { host, calls };
}

/** Un host cuyo `llm` lanza de forma síncrona. */
export function throwingLlm(error: unknown = new Error('fallo del host')): { host: EngineHost; calls: () => number } {
  let calls = 0;
  const llm = (): never => {
    calls++;
    throw error;
  };
  return { host: { llm: llm as unknown as LlmCapability }, calls: () => calls };
}

/** Un host cuyo `llm` rechaza con `reason`. */
export function rejectingLlm(reason: unknown): { host: EngineHost; calls: () => number } {
  let calls = 0;
  const llm = (): Promise<never> => {
    calls++;
    return Promise.reject(reason);
  };
  return { host: { llm: llm as unknown as LlmCapability }, calls: () => calls };
}

/** Un host con `llm` como getter: lanza al leerlo o devuelve la capacidad, y cuenta las lecturas. */
export function getterLlm(options: { throws?: boolean; capability?: LlmCapability } = {}): { host: EngineHost; reads: () => number } {
  let reads = 0;
  const host = {
    get llm() {
      reads++;
      if (options.throws) throw new Error('getter que lanza');
      return options.capability;
    },
  } as EngineHost;
  return { host, reads: () => reads };
}

/** Un host que es una instancia de clase: su método `llm` usa `this`. */
export class ClassLlmHost implements EngineHost {
  readonly reply = 'Hola desde la clase';
  receivers: unknown[] = [];
  calls = 0;

  async llm(): Promise<{ kind: 'turn'; text: string; slots: Record<string, never>; done: false; costUsd: number }> {
    this.receivers.push(this);
    this.calls++;
    return { kind: 'turn', text: this.reply, slots: {}, done: false, costUsd: 0.01 };
  }
}
