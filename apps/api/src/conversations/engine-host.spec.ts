import { startSession, type HttpCapability, type HttpRequest, type LlmCapability } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { buildEngineHost } from './engine-host.js';

const llm: LlmCapability = async () => ({ kind: 'not_configured' });
const idleHttp: HttpCapability = async () => ({ kind: 'blocked' });

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
  it('lleva las dos capacidades, las recibidas', () => {
    const host = buildEngineHost(llm, idleHttp);
    expect(host.llm).toBe(llm);
    expect(host.http).toBe(idleHttp);
    expect(Object.keys(host).sort()).toEqual(['http', 'llm']);
  });

  it('un nodo http llama a la capacidad recibida con la petición del motor', async () => {
    const seen: HttpRequest[] = [];
    const http: HttpCapability = async (request) => {
      seen.push(request);
      return { kind: 'response', status: 200, body: '' };
    };
    const result = await startSession({ flow: FLOW_CON_HTTP }, buildEngineHost(llm, http));
    expect(result).toMatchObject({ ok: true, status: 'ended' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ nodeId: 'llamar', method: 'GET', url: 'https://soporte.example.com/api', attempt: 1 });
  });

  it('un missing_secret de la capacidad hace fallar la sesión con ese código', async () => {
    const result = await startSession({ flow: FLOW_CON_HTTP }, buildEngineHost(llm, async () => ({ kind: 'missing_secret' })));
    expect(result).toMatchObject({ ok: true, status: 'failed', state: { error: { code: 'missing_secret', nodeId: 'llamar' } } });
  });
});
