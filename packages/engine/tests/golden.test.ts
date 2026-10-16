import { describe, expect, it } from 'vitest';
import { readExample, readFixture } from './helpers/files.js';
import { startSession } from '../src/index.js';

const CONTACT = { email: 'ana@example.com', visitas: 3, ajeno: 'se ignora' };

/** [nombre del golden, flujo, valores de contacto] */
const cases: [string, () => unknown, unknown?][] = [
  ['fixtures-cadena-completa', () => readFixture('cadena-completa')],
  ['fixtures-contacto-inyectado', () => readFixture('contacto'), CONTACT],
  ['fixtures-contacto-anonimo', () => readFixture('contacto')],
  ['fixtures-multimedia', () => readFixture('multimedia')],
  ['fixtures-condiciones', () => readFixture('condiciones')],
  ['fixtures-regla-invalida', () => readFixture('regla-invalida')],
  ['fixtures-nodo-http', () => readFixture('nodo-http')],
  ['fixtures-retardo', () => readFixture('retardo')],
  ['fixtures-nombres-especiales', () => readFixture('nombres-especiales')],
  ['examples-captacion-leads', () => readExample('captacion-leads')],
  ['examples-captacion-leads-con-contacto', () => readExample('captacion-leads'), { email: 'ana@example.com' }],
  ['examples-faq-ia', () => readExample('faq-ia')],
  ['rechazo-flujo-invalido', () => ({ specVersion: '0.1', id: 'roto', name: 'Roto', nodes: [] })],
];

describe('golden', () => {
  it.each(cases)('%s', async (name, flow, contact) => {
    const result = await startSession({ flow: flow(), contact });
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(`./golden/${name}.json`);
  });

  it('rechazo-contacto-invalido', async () => {
    const result = await startSession({ flow: readFixture('contacto'), contact: { email: NaN } });
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot('./golden/rechazo-contacto-invalido.json');
  });
});
