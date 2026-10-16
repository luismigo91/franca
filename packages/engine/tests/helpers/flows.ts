import { expect } from 'vitest';
import {
  startSession,
  type AdvanceResult,
  type EngineEvent,
  type SessionResult,
} from '../../src/index.js';

export type Obj = Record<string, unknown>;
export type Assignment = [variable: string, value: string | number | boolean | null];

export const message = (id: string, text: string, next: string, extra: Obj = {}): Obj => ({
  id,
  type: 'message',
  content: [{ kind: 'text', text }],
  next,
  ...extra,
});

export const setNode = (id: string, assignments: Assignment[], next: string): Obj => ({
  id,
  type: 'set',
  assignments: assignments.map(([variable, value]) => ({ variable, value })),
  next,
});

export const jump = (id: string, target: string): Obj => ({ id, type: 'jump', target });

/** Regla `variable op value`; con un solo argumento tras `op` omitido, sin la propiedad `value`. */
export const rule = (variable: string, op: string, ...value: [unknown?]): Obj =>
  value.length ? { variable, op, value: value[0] } : { variable, op };

export const condition = (id: string, rules: [when: Obj, next: string][], otherwise: string): Obj => ({
  id,
  type: 'condition',
  rules: rules.map(([when, next]) => ({ when, next })),
  else: otherwise,
});

export const end = (id: string, options: { outcome?: string; text?: string } = {}): Obj => ({
  id,
  type: 'end',
  ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
  ...(options.text === undefined ? {} : { content: [{ kind: 'text', text: options.text }] }),
});

export const http = (id: string, next: string, onError: string): Obj => ({
  id,
  type: 'http',
  request: { method: 'GET', url: 'https://example.com/ping' },
  next,
  onError,
});

export const variable = (name: string, extra: Obj = {}): Obj => ({ name, type: 'string', ...extra });

export function flowOf(
  nodes: Obj[],
  options: { id?: string; start?: string; variables?: Obj[]; settings?: Obj; extra?: Obj } = {},
): Obj {
  return {
    specVersion: '0.1',
    id: options.id ?? 'prueba',
    name: 'Prueba',
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.variables ? { variables: options.variables } : {}),
    start: options.start ?? (nodes[0] as { id: string }).id,
    nodes,
    ...options.extra,
  };
}

/**
 * Flujo con `count` nodos `set` o `jump` encadenados (`n0`…) y después `last`: ejecuta
 * `count + 1` nodos. La variable `x` está declarada para los `set`.
 */
export function chainFlow(count: number, kind: 'set' | 'jump', last: Obj, extra: Obj[] = []): Obj {
  const nodes: Obj[] = [];
  for (let i = 0; i < count; i++) {
    const next = i + 1 < count ? `n${i + 1}` : (last.id as string);
    nodes.push(kind === 'set' ? setNode(`n${i}`, [['x', i]], next) : jump(`n${i}`, next));
  }
  return flowOf([...nodes, last, ...extra], { start: count ? 'n0' : (last.id as string), variables: [variable('x')] });
}

export async function start(flow: unknown, contact?: unknown): Promise<AdvanceResult> {
  return startSession({ flow, contact });
}

/** Arranca y exige que la operación se acepte. */
export async function startOk(flow: unknown, contact?: unknown): Promise<SessionResult> {
  const result = await start(flow, contact);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as SessionResult;
}

export const eventTypes = (result: SessionResult): string[] => result.events.map((e) => e.type);

export function messageTexts(events: EngineEvent[]): string[] {
  return events.flatMap((e) =>
    e.type === 'message' ? e.content.map((c) => (c.kind === 'text' ? c.text : c.url)) : [],
  );
}

/** Congela en profundidad. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
