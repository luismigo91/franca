import { afterEach, describe, expect, it, vi } from 'vitest';
import { continueSession, startSession } from '../src/index.js';
import { allFlows } from './helpers/files.js';
import { deepFreeze } from './helpers/flows.js';

const CONTACT = { email: 'ana@example.com', visitas: 3, ajeno: { x: [1] } };
const flows = allFlows();

describe('propiedades sobre todos los fixtures y ejemplos', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(flows.map((f) => [f.label, f.flow] as const))('%s: determinismo', async (_label, flow) => {
    const a = await startSession({ flow: structuredClone(flow), contact: CONTACT });
    const b = await startSession({ flow: structuredClone(flow), contact: CONTACT });
    expect(a).toEqual(b);
  });

  it.each(flows.map((f) => [f.label, f.flow] as const))('%s: entradas congeladas y sin cambios', async (_label, flow) => {
    const frozenFlow = deepFreeze(structuredClone(flow));
    const frozenContact = deepFreeze(structuredClone(CONTACT));
    const result = await startSession({ flow: frozenFlow, contact: frozenContact });
    expect(result.ok).toBe(true);
    expect(frozenFlow).toEqual(flow);
    expect(frozenContact).toEqual(CONTACT);
  });

  it.each(flows.map((f) => [f.label, f.flow] as const))('%s: ida y vuelta JSON del estado', async (_label, flow) => {
    const result = await startSession({ flow, contact: CONTACT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
    expect(JSON.parse(JSON.stringify(result.events))).toEqual(result.events);
  });

  it('ningún método de console se llama (termina, falla y se rechaza)', async () => {
    const spies = (Object.keys(console) as (keyof Console)[])
      .filter((key) => typeof console[key] === 'function')
      .map((key) => vi.spyOn(console, key as 'log').mockImplementation(() => {}));
    for (const { flow } of flows) {
      const result = await startSession({ flow, contact: CONTACT });
      if (result.ok) await continueSession({ flow, state: result.state, input: 'x' });
    }
    await startSession({ flow: {} });
    await startSession({ flow: flows[0]!.flow, contact: 5 });
    await continueSession({ flow: flows[0]!.flow, state: {}, input: 1 });
    expect(spies.length).toBeGreaterThan(5);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('un estado en espera continuado con null da invalid_input; uno ended/failed, session_not_active', async () => {
    for (const { label, flow } of flows) {
      const result = await startSession({ flow });
      if (!result.ok) continue;
      const state = JSON.parse(JSON.stringify(result.state));
      const next = await continueSession({ flow, state, input: null });
      const expected = result.status === 'waiting' ? 'invalid_input' : 'session_not_active';
      expect(next, label).toMatchObject({ ok: false, code: expected });
    }
  });
});
