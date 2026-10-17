import { describe, expect, it } from 'vitest';
import type { TransportResult } from '@/server/api/transport';
import { toWebResponse } from '@/server/bff/responses';

const response = (status: number, body: unknown): TransportResult => ({ kind: 'response', status, body: body === null ? null : new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)) });

describe('toWebResponse', () => {
  it('el message de un error de la API nunca sale, con ningún código', async () => {
    for (const status of [400, 404, 409, 412, 428, 500, 503]) {
      const out = toWebResponse(response(status, { message: 'MARCA-MENSAJE', error: 'conversation_busy', issues: ['x'] }), 'json');
      expect(out.status).toBe(status);
      const text = await out.text();
      expect(text).not.toContain('MARCA-MENSAJE');
      expect(JSON.parse(text)).toEqual({ error: 'conversation_busy' });
    }
  });

  it('el message de un error de events[] y de items[].event se quita; el de otro evento no', async () => {
    const advance = toWebResponse(response(200, { conversation: {}, events: [{ type: 'error', nodeId: 'a', code: 'x', message: 'MARCA-MENSAJE' }, { type: 'message', message: 'queda' }] }), 'json');
    const page = toWebResponse(response(200, { items: [{ seq: 1, event: { type: 'error', code: 'x', message: 'MARCA-MENSAJE' } }, { seq: 2, role: 'user', input: { text: 'hola' } }], total: 2 }), 'json');
    expect(JSON.stringify(await advance.json())).not.toContain('MARCA-MENSAJE');
    expect(JSON.stringify(await page.json())).not.toContain('MARCA-MENSAJE');
    const again = toWebResponse(response(200, { events: [{ type: 'message', message: 'queda' }] }), 'json');
    expect(JSON.stringify(await again.json())).toContain('queda');
  });

  it('el 204 solo es éxito en delete', async () => {
    const ok = toWebResponse(response(204, null), 'delete');
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe('');
    expect(toWebResponse(response(204, null), 'json').status).toBe(502);
    expect(toWebResponse(response(204, null), 'flowVersion').status).toBe(502);
  });

  it('unreachable e invalid', async () => {
    expect(await toWebResponse({ kind: 'unreachable' }, 'json').json()).toEqual({ error: 'api_unreachable' });
    expect(toWebResponse({ kind: 'unreachable' }, 'json').status).toBe(502);
    expect(await toWebResponse({ kind: 'invalid' }, 'json').json()).toEqual({ error: 'invalid_api_response' });
  });

  it('un 3xx o un 1xx de la API no se reenvían', async () => {
    for (const status of [301, 302, 304, 199]) expect(toWebResponse(response(status, { error: 'x' }), 'json').status).toBe(502);
  });

  it('toda respuesta lleva no-store', () => {
    for (const result of [response(200, { a: 1 }), response(409, { error: 'x_y' }), response(500, null), { kind: 'unreachable' } as const]) {
      expect(toWebResponse(result, 'json').headers.get('cache-control')).toContain('no-store');
    }
  });
});
