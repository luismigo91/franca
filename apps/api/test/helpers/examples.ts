import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const specDir = dirname(createRequire(import.meta.url).resolve('@franca/spec/flow.schema.json'));

/** Texto de un flujo de ejemplo de `@franca/spec`, tal como está en disco. */
export const exampleText = (name: 'captacion-leads' | 'faq-ia'): string => readFileSync(join(specDir, 'examples', `${name}.json`), 'utf8');

/** Copia nueva de un flujo de ejemplo de `@franca/spec` (los tests la mutan). */
export const example = (name: 'captacion-leads' | 'faq-ia'): any => JSON.parse(exampleText(name));

/** `captacion-leads` (el flujo largo de los escenarios). */
export const leads = (): any => example('captacion-leads');

/** `faq-ia`. */
export const faq = (): any => example('faq-ia');

/** El flujo mínimo `hola` de los escenarios. */
export const hola = (): any => ({
  specVersion: '0.1',
  id: 'hola',
  name: 'Hola',
  start: 'fin',
  nodes: [{ id: 'fin', type: 'end' }],
});

/** Índice del nodo `enviar-crm` (http) en `captacion-leads`. */
export const HTTP_NODE = 6;
