import { describe, expect, it } from 'vitest';
import { continueSession, startSession, type SessionResult } from '../src/index.js';
import { exampleNames, readExample } from './helpers/files.js';
import { always, expectScript, respond } from './helpers/http-host.js';

/** Respuesta canónica para cada tipo de input. */
function canonicalAnswer(event: Extract<SessionResult['events'][number], { type: 'input' }>): unknown {
  if (event.inputType === 'choice') {
    return event.multiple ? { choices: [event.choices[0]!.id] } : { choice: event.choices[0]!.id };
  }
  const text: Record<string, string> = {
    text: 'Ana',
    email: 'ana@example.com',
    phone: '600123456',
    number: '42',
    url: 'example.com',
    date: '2026-10-16',
    boolean: 'sí',
  };
  return { text: text[event.inputType] };
}

describe('ejemplos de packages/spec/examples', () => {
  it('hay ejemplos', () => {
    expect(exampleNames().length).toBeGreaterThanOrEqual(2);
  });

  it.each(exampleNames())('%s: arrancar no se rechaza y termina en ended, waiting o unsupported_node', async (name) => {
    const result = await startSession({ flow: readExample(name) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stoppedAtUnsupported = result.state.error?.code === 'unsupported_node';
    expect(result.status === 'ended' || result.status === 'waiting' || stoppedAtUnsupported).toBe(true);
  });

  it.each(exampleNames())('%s: el recorrido con respuestas canónicas no se rechaza y acaba en ended o failed', async (name) => {
    const flow = readExample(name);
    let result = await startSession({ flow });
    for (let operations = 1; operations <= 50; operations++) {
      expect(result.ok, `${name} operación ${operations}`).toBe(true);
      if (!result.ok || result.status !== 'waiting') break;
      const event = result.events.findLast((e) => e.type === 'input');
      if (event?.type !== 'input') throw new Error('una sesión en espera termina con un evento input');
      result = await continueSession({ flow, state: result.state, input: canonicalAnswer(event) });
    }
    expect(result.ok && (result.status === 'ended' || result.status === 'failed')).toBe(true);
  });

  it.each(exampleNames())('%s: el recorrido con un host que responde 200 {} no se rechaza', async (name) => {
    const flow = readExample(name);
    const host = always(respond(200, '{}'));
    let result = await startSession({ flow }, host.host);
    for (let operations = 1; operations <= 50; operations++) {
      expect(result.ok, `${name} operación ${operations}`).toBe(true);
      if (!result.ok || result.status !== 'waiting') break;
      const event = result.events.findLast((e) => e.type === 'input');
      if (event?.type !== 'input') throw new Error('una sesión en espera termina con un evento input');
      result = await continueSession({ flow, state: result.state, input: canonicalAnswer(event) }, host.host);
    }
    expectScript(host);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (name === 'captacion-leads') {
      // con un host que ofrece http, la conversación se completa: envía el lead y termina
      expect(result.status).toBe('ended');
      expect(host.requests).toHaveLength(1);
      expect(host.requests[0]).toMatchObject({ nodeId: 'enviar-crm', method: 'POST', attempt: 1 });
    } else {
      expect(result.status === 'ended' || result.status === 'failed').toBe(true);
    }
  });
});
