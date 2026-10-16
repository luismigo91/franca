import { expect } from 'vitest';
import type { EngineHost, HttpRequest } from '../../src/index.js';

/** Valor a resolver, o función (puede lanzar o devolver una promesa). */
export type Step = unknown | ((request: HttpRequest, index: number) => unknown);

export interface ScriptedHost {
  host: EngineHost;
  /** `structuredClone` de cada petición en el momento de la llamada: un host que muta la suya no altera el registro. */
  requests: HttpRequest[];
  /** Llamadas en curso a la vez, para «Llamadas en secuencia». */
  readonly maxInFlight: number;
  /** Llamadas de más sobre el guion (todo test lo exige a 0 con `expectScript`). */
  readonly overrun: number;
}

/**
 * Host falso programable, sin red ni reloj: cada llamada resuelve el siguiente paso del guion.
 * Un paso es el valor a resolver o una función `(request, index)`.
 */
export function scriptedHost(steps: readonly Step[], options: { repeatLast?: boolean } = {}): ScriptedHost {
  const requests: HttpRequest[] = [];
  let inFlight = 0;
  const state = { maxInFlight: 0, overrun: 0 };
  let index = 0;
  const http = async (request: HttpRequest): Promise<unknown> => {
    requests.push(structuredClone(request));
    const at = index++;
    inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    try {
      const overran = at >= steps.length;
      if (overran && !(options.repeatLast && steps.length > 0)) {
        state.overrun++;
        return { kind: 'blocked' };
      }
      const step = steps[Math.min(at, steps.length - 1)];
      return typeof step === 'function' ? await step(request, at) : step;
    } finally {
      inFlight--;
    }
  };
  return {
    host: { http: http as EngineHost['http'] },
    requests,
    get maxInFlight() {
      return state.maxInFlight;
    },
    get overrun() {
      return state.overrun;
    },
  };
}

export const respond = (status = 200, body = '') => ({ kind: 'response', status, body }) as const;

/** Un host que resuelve siempre lo mismo. */
export const always = (step: Step): ScriptedHost => scriptedHost([step], { repeatLast: true });

/** Afirma que el guion no se desbordó y, si se indica, el número de llamadas. */
export function expectScript(h: ScriptedHost, calls?: number): void {
  expect(h.overrun, 'llamadas de más sobre el guion').toBe(0);
  if (calls !== undefined) expect(h.requests, 'llamadas al host').toHaveLength(calls);
}

/** Un host cuyo `http` lanza de forma síncrona. */
export function throwingHost(error: unknown = new Error('fallo del host')): { host: EngineHost; calls: () => number } {
  let calls = 0;
  const http = (): never => {
    calls++;
    throw error;
  };
  return { host: { http: http as unknown as EngineHost['http'] }, calls: () => calls };
}

/** Un host cuyo `http` rechaza con `reason`. */
export function rejectingHost(reason: unknown): { host: EngineHost; calls: () => number } {
  let calls = 0;
  const http = (): Promise<never> => {
    calls++;
    return Promise.reject(reason);
  };
  return { host: { http: http as unknown as EngineHost['http'] }, calls: () => calls };
}

/** Un host con `http` como getter: lanza al leerlo o devuelve la capacidad, y cuenta las lecturas. */
export function getterHost(options: { throws?: boolean; capability?: EngineHost['http'] } = {}): { host: EngineHost; reads: () => number } {
  let reads = 0;
  const host = {
    get http() {
      reads++;
      if (options.throws) throw new Error('getter que lanza');
      return options.capability;
    },
  } as EngineHost;
  return { host, reads: () => reads };
}

/** Un host que es una instancia de clase: su método `http` usa `this`. */
export class ClassHost implements EngineHost {
  readonly status = 200;
  receivers: unknown[] = [];
  calls = 0;

  async http(): Promise<{ kind: 'response'; status: number; body: string }> {
    this.receivers.push(this);
    this.calls++;
    return { kind: 'response', status: this.status, body: '' };
  }
}

export type LeakVariant = 'throws' | 'rejects' | 'body500' | 'extra200' | 'malformed';
export const LEAK_VARIANTS: readonly LeakVariant[] = ['throws', 'rejects', 'body500', 'extra200', 'malformed'];

/**
 * Un host que ha resuelto el secreto a `marker` y lo devuelve de las cinco formas en que un host
 * real podría filtrarlo: en el mensaje de un error, en un rechazo, en el cuerpo de un 500, en una
 * propiedad adicional de un 200 y dentro de un resultado mal formado.
 */
export function secretLeakingHost(marker: string, variant: LeakVariant): ScriptedHost {
  const steps: Record<LeakVariant, Step> = {
    throws: () => {
      throw new Error(`fallo con Authorization: ${marker}`);
    },
    rejects: () => Promise.reject(new Error(`rechazo con ${marker}`)),
    body500: respond(500, `{"eco":"${marker}"}`),
    extra200: { kind: 'response', status: 200, body: '{}', secret: marker, headers: { authorization: marker } },
    malformed: { kind: 'otro', authorization: marker },
  };
  return scriptedHost([steps[variant]], { repeatLast: true });
}
