import { describe, expect, it } from 'vitest';
import { continueSession, type SessionState } from '../../src/index.js';
import { deepFreeze, end, flowOf, http, message, startOk } from '../helpers/flows.js';

const flowA = () => flowOf([message('m', 'Hola', 'fin'), end('fin')], { id: 'a' });

describe('Continuar una sesión', () => {
  it('Sesión terminada', async () => {
    const flow = flowA();
    const { state } = await startOk(flow);
    expect(state.status).toBe('ended');
    const frozen = deepFreeze(structuredClone(state));
    const result = await continueSession({ flow, state: frozen, input: 'hola' });
    expect(result).toMatchObject({ ok: false, code: 'session_not_active' });
    expect(result).not.toHaveProperty('events');
    expect(result).not.toHaveProperty('state');
    expect(frozen).toEqual(state);
  });

  it('Sesión fallida', async () => {
    const flow = flowOf([http('h', 'fin', 'fin'), end('fin')], { id: 'a' });
    const { state } = await startOk(flow);
    expect(state.status).toBe('failed');
    expect(await continueSession({ flow, state, input: 'hola' })).toMatchObject({
      ok: false,
      code: 'session_not_active',
    });
  });

  it('Estado de otro flujo', async () => {
    const { state } = await startOk(flowA());
    const flowB = flowOf([end('fin')], { id: 'b' });
    expect(await continueSession({ flow: flowB, state, input: 'hola' })).toMatchObject({
      ok: false,
      code: 'state_mismatch',
    });
  });

  it('Nodo del estado ya no existe', async () => {
    const { state } = await startOk(flowA());
    expect(state.nodeId).toBe('fin');
    const nueva = flowOf([message('m', 'Hola', 'final'), end('final')], { id: 'a' });
    expect(await continueSession({ flow: nueva, state, input: 'hola' })).toMatchObject({
      ok: false,
      code: 'state_mismatch',
    });
  });

  it('Estado mal formado o de versión desconocida', async () => {
    const flow = flowA();
    const { state } = await startOk(flow);
    for (const bad of [{}, null, 'estado', { ...state, stateVersion: 2 }, { ...state, stateVersion: undefined }]) {
      expect(await continueSession({ flow, state: bad, input: 'hola' }), JSON.stringify(bad)).toMatchObject({
        ok: false,
        code: 'invalid_state',
      });
    }
  });

  it('El flujo se comprueba primero', async () => {
    const result = await continueSession({ flow: { specVersion: '0.1' }, state: {}, input: 'hola' });
    expect(result).toMatchObject({ ok: false, code: 'invalid_flow' });
    expect('issues' in result && result.issues.length).toBeGreaterThan(0);
  });

  it('el estado se comprueba antes que la coincidencia de flujo', async () => {
    const result = await continueSession({ flow: flowA(), state: { flowId: 'otro' } as unknown as SessionState, input: 1 });
    expect(result).toMatchObject({ ok: false, code: 'invalid_state' });
  });
});
