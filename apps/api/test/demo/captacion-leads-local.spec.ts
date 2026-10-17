import { readFileSync } from 'node:fs';
import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { demoHttpVariables } from '../../demo/demo-config.mjs';
import { loadHttpHostConfig } from '../../src/http-host/http-host-config.js';
import { example } from '../helpers/examples.js';

const copy = JSON.parse(readFileSync(new URL('../../demo/captacion-leads-local.json', import.meta.url), 'utf8'));

/** Quita lo que la copia cambia a propósito. */
function omit(flow: any): any {
  const clone = structuredClone(flow);
  delete clone.id;
  delete clone.name;
  delete clone.description;
  delete clone.nodes[6].request.url;
  return clone;
}

describe('captacion-leads-local', () => {
  it('Paridad con el ejemplo canónico', () => {
    const canonical = example('captacion-leads');
    expect(copy.nodes[6].id).toBe('enviar-crm');
    expect(omit(copy)).toEqual(omit(canonical));
    expect(copy.id).toBe('captacion-leads-local');
    expect(copy.name).toBe('Captación de leads (local)');
    expect(copy.description).toBe('Copia de captacion-leads para la demo local: envía el lead al CRM simulado.');
    expect(copy.nodes[6].request.url).toBe('http://crm.franca.test:4010/api/leads');
    const verdict = validateFlow(copy);
    expect(verdict.valid).toBe(true);
    expect(verdict.warnings).toEqual([]);
  });

  it('el ejemplo canónico sigue llamando a otro sitio: la copia no lo ha tocado', () => {
    expect(example('captacion-leads').nodes[6].request.url).toBe('https://crm.example.com/api/leads');
  });

  it('su url cuadra con la configuración de la demo: origen del secreto, nombre local y par permitido', async () => {
    const url = new URL(copy.nodes[6].request.url);
    const config = await loadHttpHostConfig(demoHttpVariables({ token: 'Bearer prueba-cruce' }));
    expect(config.secrets.get('CRM_TOKEN')?.origins.has(url.origin)).toBe(true);
    expect(config.localNames.map((entry) => entry.name)).toContain(url.hostname);
    const address = config.localNames.find((entry) => entry.name === url.hostname)!.addresses[0]!.address;
    expect(config.allowedDestinations.map((entry) => entry.display)).toContain(`${address}:${url.port}`);
    expect(copy.nodes[6].request.headers.Authorization).toEqual({ secret: 'CRM_TOKEN' });
  });
});
