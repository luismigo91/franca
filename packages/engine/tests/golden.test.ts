import { describe, expect, it } from 'vitest';
import { converse } from './helpers/conversation.js';
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

/** Conversaciones: array de resultados; cada paso continúa desde el último estado aceptado. */
const conversations: [string, () => unknown, unknown[]][] = [
  [
    'conversacion-captacion-leads',
    () => readExample('captacion-leads'),
    [{ text: ' Ana ' }, { text: 'ana@' }, { text: 'ana@example.com' }, { choice: 'grande' }],
  ],
  [
    'conversacion-captacion-leads-agotada',
    () => readExample('captacion-leads'),
    [{ text: 'Ana' }, { choice: 'x' }, { text: 'ana@' }, { text: 'ana@@' }, { text: 'ana' }],
  ],
  ['conversacion-seleccion-multiple', () => readFixture('seleccion-multiple'), [{ choices: [] }, { choices: ['c', 'a'] }]],
];

describe('golden', () => {
  it.each(conversations)('%s', async (name, flow, steps) => {
    const results = await converse(flow(), steps);
    await expect(`${JSON.stringify(results, null, 2)}\n`).toMatchFileSnapshot(`./golden/${name}.json`);
  });

  it.each(cases)('%s', async (name, flow, contact) => {
    const result = await startSession({ flow: flow(), contact });
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(`./golden/${name}.json`);
  });

  it('rechazo-contacto-invalido', async () => {
    const result = await startSession({ flow: readFixture('contacto'), contact: { email: NaN } });
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot('./golden/rechazo-contacto-invalido.json');
  });
});
