import { startSession, type LlmCapability } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { buildEngineHost } from './engine-host.js';

const llm: LlmCapability = async () => ({ kind: 'not_configured' });

const FLOW_CON_HTTP = {
  specVersion: '0.1',
  id: 'con-http',
  name: 'Con http',
  start: 'llamar',
  nodes: [
    { id: 'llamar', type: 'http', request: { method: 'GET', url: 'https://soporte.example.com/api' }, next: 'fin', onError: 'fin' },
    { id: 'fin', type: 'end' },
  ],
};

describe('buildEngineHost', () => {
  it('lleva la capacidad llm y no tiene la propiedad http', () => {
    const host = buildEngineHost(llm);
    expect(host.llm).toBe(llm);
    expect(Object.keys(host)).toEqual(['llm']);
    expect('http' in host).toBe(false);
  });

  it('un nodo http falla con unsupported_node con este host', async () => {
    const result = await startSession({ flow: FLOW_CON_HTTP }, buildEngineHost(llm));
    expect(result).toMatchObject({ ok: true, status: 'failed', state: { error: { code: 'unsupported_node', nodeId: 'llamar' } } });
  });
});
