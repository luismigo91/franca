import { afterEach, describe, expect, it } from 'vitest';
import { leadsWith } from './helpers/http-flows.js';
import { CRM_VARIABLES, startWorld, type HttpWorld } from './helpers/http-world.js';

/** Hay exactamente una línea con la palabra clave del aviso, y contiene todas las partes. */
function expectOneLine(lines: readonly string[], keyword: string, ...parts: string[]): void {
  const matching = lines.filter((line) => line.includes(keyword));
  expect(matching, `líneas con ${keyword}`).toHaveLength(1);
  for (const part of parts) expect(matching[0], part).toContain(part);
}

describe('salida http: registros (e2e)', () => {
  let current: HttpWorld | undefined;
  const closeCurrent = async (): Promise<void> => {
    const previous = current;
    current = undefined;
    await previous?.close();
  };
  afterEach(closeCurrent);

  /** Una API nueva con las variables dadas; cierra la anterior (la salida capturada es global, no se anidan). */
  async function world(variables: Record<string, string> = CRM_VARIABLES): Promise<HttpWorld> {
    await closeCurrent();
    current = await startWorld({ variables });
    return current;
  }

  it('Llamada http fuera del registro', async () => {
    const w = await world();
    await w.crm({ kind: 'respond', status: 201, body: '{"id":"L-1","eco":"MARCA-RESPUESTA"}' });
    const flow = leadsWith({ url: 'https://crm.example.com/api/leads?origen=MARCA-URL', headers: { 'X-Campana': 'MARCA-CABECERA' } });
    await w.ctx.publish(flow);
    // «Desde que se crea la primera conversación»: la línea de arranque sí nombra los orígenes de los secretos.
    w.output.clear();
    const first = await w.ctx.start('captacion-leads');
    await w.ctx.say(first.id, { text: 'Ana' });
    await w.ctx.say(first.id, { text: 'ana@example.com' });
    const sent = await w.ctx.say(first.id, { choice: 'grande' });
    expect(sent.conversation).toMatchObject({ status: 'ended', outcome: 'lead-empresa' });

    // Otra conversación con el nombre resolviendo a una dirección interna: el aviso de destino no nombra nada de la llamada.
    w.network.resolve('crm.example.com', ['10.0.0.5']);
    const second = await w.ctx.start('captacion-leads');
    await w.ctx.say(second.id, { text: 'Ana' });
    await w.ctx.say(second.id, { text: 'ana@example.com' });
    const blocked = await w.ctx.say(second.id, { choice: 'grande' });
    expect(blocked.conversation).toMatchObject({ status: 'ended', outcome: 'lead-sin-enviar' });

    const output = w.output.text();
    expect(output).toContain('blocked');
    for (const marker of ['MARCA-URL', 'MARCA-CABECERA', 'MARCA-RESPUESTA', 'crm.example.com', '10.0.0.5', 'ana@example.com', 'prueba-crm-1']) {
      expect(output, marker).not.toContain(marker);
    }
  });

  it('Avisos de secreto en el registro', async () => {
    // La primera, sin secretos en la API; la segunda, con el CRM del test pero otro origen autorizado.
    const sin = await world({});
    const firstId = await sin.leadsReady();
    await sin.sendSize(firstId);
    expectOneLine(sin.output.all(), 'missing_secret', firstId, 'enviar-crm', 'CRM_TOKEN', 'not_configured');

    const otro = await world({ ...CRM_VARIABLES, FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=https://crm.example.com:8443' });
    await otro.crm();
    const secondId = await otro.leadsReady();
    await otro.sendSize(secondId);
    expectOneLine(otro.output.all(), 'missing_secret', secondId, 'enviar-crm', 'CRM_TOKEN', 'origin_not_allowed');
    expect(otro.output.text()).not.toContain('prueba-crm-1');
  });

  it('Avisos de destino en el registro', async () => {
    const w = await world();
    await w.crm();
    w.network.resolve('crm.example.com', ['10.0.0.5']);
    const id = await w.leadsReady();
    await w.sendSize(id);
    expectOneLine(w.output.all(), 'blocked', id, 'enviar-crm', 'internal_destination');
  });
});
