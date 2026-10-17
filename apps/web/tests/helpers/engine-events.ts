import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { continueSession, startSession, type EngineEvent, type SessionResult } from '@franca/engine';
import { REPO_ROOT, WEB_ROOT } from './paths';

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;

/** Los flujos de los escenarios: dos de los ejemplos de `@franca/spec` y los que fijan los E2E. */
export const FLOWS = {
  'captacion-leads': read(resolve(REPO_ROOT, 'packages/spec/examples/captacion-leads.json')),
  'faq-ia': read(resolve(REPO_ROOT, 'packages/spec/examples/faq-ia.json')),
  pregunta: read(resolve(WEB_ROOT, 'e2e/fixtures/flows/pregunta.json')),
  'saludo-contacto': read(resolve(WEB_ROOT, 'e2e/fixtures/flows/saludo-contacto.json')),
  hola: read(resolve(WEB_ROOT, 'e2e/fixtures/flows/hola.json')),
  preguntas: read(resolve(WEB_ROOT, 'e2e/fixtures/flows/preguntas.json')),
  medios: read(resolve(WEB_ROOT, 'e2e/fixtures/flows/medios.json')),
} as const;

export interface Step {
  events: EngineEvent[];
  result: SessionResult;
}

/**
 * Ejecuta un flujo con el motor real: la creación y una entrada por cada elemento de `inputs`. Los eventos que
 * devuelve son los que verá el chat, sin ninguna forma inventada. No hay host: ningún `http` ni `llm` sale a la red.
 *
 * @throws Si el motor rechaza alguno de los pasos.
 */
export async function runFlow(flow: unknown, inputs: readonly unknown[] = []): Promise<Step[]> {
  const steps: Step[] = [];
  let result = await startSession({ flow });
  if (!result.ok) throw new Error(`el motor rechazó el flujo: ${result.code}`);
  steps.push({ events: result.events, result });
  for (const input of inputs) {
    const next = await continueSession({ flow, state: result.state, input });
    if (!next.ok) throw new Error(`el motor rechazó la entrada: ${next.code}`);
    result = next;
    steps.push({ events: next.events, result: next });
  }
  return steps;
}
