import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicClient, createAnthropicProvider } from '../../src/index.js';
import { fakeApi, ok, spyOnConsole, turnRequest } from '../helpers/fake-api.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Cliente sin registro de contenido', () => {
  it('Cliente sin registro de contenido', async () => {
    vi.stubEnv('ANTHROPIC_LOG', 'debug');
    vi.stubEnv('ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE', 'content');
    const spies = spyOnConsole();
    const api = fakeApi([ok({ text: 'Hola' })]);
    const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetch: api.fetch });
    expect(client.logLevel).toBe('off');
    expect(client.openTelemetry.traces.contentMode).toBe('metadata_only');
    const result = await createAnthropicProvider({ client })(turnRequest({ history: [{ role: 'assistant', text: 'MARCA-HISTORIAL' }, { role: 'user', text: 'MARCA-HISTORIAL' }], turn: 2 }));
    expect(result.kind).toBe('turn');
    expect(spies.length).toBeGreaterThan(5);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
