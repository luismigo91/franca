import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_ADVANCE } from '../../src/index.js';
import {
  chainFlow,
  condition,
  end,
  flowOf,
  http,
  jump,
  message,
  rule,
  setNode,
  startOk,
  variable,
} from '../helpers/flows.js';

const example = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../spec/examples/${name}.json`, import.meta.url), 'utf8'));

describe('Nodos aún no soportados', () => {
  it('Ejemplo de captación de leads', async () => {
    const result = await startOk(example('captacion-leads'));
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([
      {
        type: 'message',
        nodeId: 'bienvenida',
        content: [{ kind: 'text', text: '¡Hola! Te hago tres preguntas y te paso con la persona adecuada.' }],
        typingDelayMs: 600,
      },
      { type: 'error', nodeId: 'pedir-nombre', code: 'unsupported_node', message: expect.stringContaining('input') },
    ]);
  });

  it('Ejemplo de FAQ con IA', async () => {
    const result = await startOk(example('faq-ia'));
    expect(result.events).toEqual([
      {
        type: 'message',
        nodeId: 'saludo',
        content: [{ kind: 'text', text: 'Hola, soy el asistente. Pregúntame lo que necesites sobre el servicio.' }],
        typingDelayMs: 400,
      },
      { type: 'error', nodeId: 'asistente', code: 'unsupported_node', message: expect.stringContaining('llm') },
    ]);
  });

  it('Nodo http tras un set', async () => {
    const flow = flowOf([setNode('s', [['x', 'hecho']], 'h'), http('h', 'fin', 'fin'), end('fin')], {
      variables: [variable('x')],
    });
    const result = await startOk(flow);
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'h', code: 'unsupported_node', message: expect.stringContaining('http') },
    ]);
    expect(result.state.variables).toEqual({ x: 'hecho' });
    expect(result.state.error).toEqual({ code: 'unsupported_node', nodeId: 'h' });
  });
});

describe('Límite de pasos por avance', () => {
  it('Ciclo sin mensajes', async () => {
    const flow = flowOf(
      [condition('c', [[rule('v', 'eq', 'nunca'), 'fin']], 'j'), jump('j', 'c'), end('fin')],
      { variables: [variable('v')] },
    );
    const result = await startOk(flow);
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'c', code: 'step_limit_exceeded', message: expect.any(String) },
    ]);
    expect(result.status).toBe('failed');
  });

  it('Ciclo con mensajes', async () => {
    const flow = flowOf(
      [message('m', 'Otra vez', 'c'), condition('c', [[rule('v', 'eq', 'nunca'), 'fin']], 'm'), end('fin')],
      { variables: [variable('v')] },
    );
    const result = await startOk(flow);
    expect(result.events).toHaveLength(101);
    expect(result.events.slice(0, 100).every((e) => e.type === 'message')).toBe(true);
    expect(result.events[100]).toMatchObject({ type: 'error', code: 'step_limit_exceeded', nodeId: 'm' });
  });

  it.each(['set', 'jump'] as const)('Justo en el límite (%s)', async (kind) => {
    const result = await startOk(chainFlow(MAX_STEPS_PER_ADVANCE - 1, kind, end('fin')));
    expect(result.status).toBe('ended');
  });

  it.each(['set', 'jump'] as const)('Un nodo por encima del límite (%s)', async (kind) => {
    const result = await startOk(chainFlow(MAX_STEPS_PER_ADVANCE, kind, end('fin')));
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'fin', code: 'step_limit_exceeded', message: expect.any(String) },
    ]);
    expect(result.state.nodeId).toBe('fin');
  });

  it.each(['set', 'jump'] as const)('El límite gana a un nodo no soportado (%s)', async (kind) => {
    const result = await startOk(chainFlow(MAX_STEPS_PER_ADVANCE, kind, http('h', 'fin', 'fin'), [end('fin')]));
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'h', code: 'step_limit_exceeded', message: expect.any(String) },
    ]);
  });

  it('el contador se reinicia en cada operación', async () => {
    const flow = chainFlow(MAX_STEPS_PER_ADVANCE - 1, 'jump', end('fin'));
    expect((await startOk(flow)).status).toBe('ended');
    expect((await startOk(flow)).status).toBe('ended');
  });
});
