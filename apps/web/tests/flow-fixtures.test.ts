import { readFileSync } from 'node:fs';
import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { effectiveSpec } from './helpers/spec-text';

/** El JSON que la spec escribe para un flujo: `` `name` es `{…}` `` en el texto de la capacidad. */
function jsonInSpec(text: string, name: string): unknown {
  const match = new RegExp('`' + name + '` es `(\\{.*?\\})`(?:[ .,;]|$)', 'm').exec(text);
  if (!match) throw new Error(`la spec no escribe el flujo ${name}`);
  return JSON.parse(match[1]!) as unknown;
}

const FIXTURES: Array<[name: string, capability: 'web-chat' | 'conversations-api' | 'flows-api']> = [
  ['pregunta', 'conversations-api'],
  ['saludo-contacto', 'conversations-api'],
  ['hola', 'flows-api'],
  ['preguntas', 'web-chat'],
  ['medios', 'web-chat'],
];

describe('fixtures de flujos de los E2E', () => {
  it.each(FIXTURES)('%s es igual al JSON de su spec y válido sin avisos', (name, capability) => {
    const fixture = JSON.parse(readFileSync(new URL(`../e2e/fixtures/flows/${name}.json`, import.meta.url), 'utf8')) as unknown;
    expect(fixture).toEqual(jsonInSpec(effectiveSpec(capability).text, name));
    const result = validateFlow(fixture);
    expect(result.valid, JSON.stringify(result)).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
