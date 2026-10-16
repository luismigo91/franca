import { llmFlow, llmNode } from '../helpers/flows.js';
import { always, respond } from '../helpers/http-host.js';
import { alwaysLlm, expectLlmScript, scriptedLlm, turn } from '../helpers/llm-host.js';
import { begin, proceed } from '../helpers/llm-run.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_ADVANCE } from '../../src/index.js';
import { replyOk, waiting } from '../helpers/conversation.js';
import {
  chainFlow,
  condition,
  end,
  flowOf,
  http,
  input,
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
    const flow = example('captacion-leads');
    const { state } = await waiting(flow);
    const name = await replyOk(flow, state, { text: 'Ana' });
    const mail = await replyOk(flow, name.state, { text: 'ana@example.com' });
    expect(mail.state.nodeId).toBe('pedir-tamano');
    const result = await replyOk(flow, mail.state, { choice: 'pequena' });
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'enviar-crm', code: 'unsupported_node', message: expect.stringContaining('http') },
    ]);
    expect(result.state.variables.segmento).toBe('pyme');
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

describe('Límite de pasos con input', () => {
  it.each(['set', 'jump'] as const)('El límite gana a un input (%s)', async (kind) => {
    const last = input('pregunta', 'x', 'text', 'fin');
    const result = await startOk(chainFlow(MAX_STEPS_PER_ADVANCE, kind, last, [end('fin')]));
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'pregunta', code: 'step_limit_exceeded', message: expect.any(String) },
    ]);
    expect(result.status).toBe('failed');
  });

  it('Al continuar cuenta el input', async () => {
    const build = (n: number) => {
      const nodes = [input('p', 'x', 'text', n ? 'n0' : 'fin')];
      for (let i = 0; i < n; i++) nodes.push(i % 2 ? jump(`n${i}`, i + 1 < n ? `n${i + 1}` : 'fin') : setNode(`n${i}`, [['x', i]], i + 1 < n ? `n${i + 1}` : 'fin'));
      return flowOf([...nodes, end('fin')], { variables: [variable('x')] });
    };
    const ok = build(198);
    const over = build(199);
    const okResult = await replyOk(ok, (await waiting(ok)).state, { text: 'hola' });
    expect(okResult.status).toBe('ended');
    const overResult = await replyOk(over, (await waiting(over)).state, { text: 'hola' });
    expect(overResult.status).toBe('failed');
    expect(overResult.events).toEqual([
      { type: 'error', nodeId: 'fin', code: 'step_limit_exceeded', message: expect.any(String) },
    ]);
  });
});

describe('Nodos aún no soportados: llm', () => {
  it('Nodo llm tras un set', async () => {
    const flow = llmFlow({}, { nodes: [setNode('s', [['nombre', 'hecho']], 'a'), llmNode(), end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })] });
    const result = await begin(flow, always(respond(200)).host);
    expect(result.events).toEqual([{ type: 'error', nodeId: 'a', code: 'unsupported_node', message: expect.stringContaining('llm') }]);
    expect(result.state.variables).toEqual({ nombre: 'hecho' });
    expect(result.state.error).toEqual({ code: 'unsupported_node', nodeId: 'a' });
  });
});

describe('Límite de pasos con llm', () => {
  it.each(['set', 'jump'] as const)('El límite gana a un llm (%s)', async (kind) => {
    const flow = chainFlow(MAX_STEPS_PER_ADVANCE, kind, llmNode({ slots: undefined, id: 'asistente', next: 'fin', onExhausted: 'fin' }), [end('fin')]);
    const llm = alwaysLlm(turn('Hola'));
    const result = await begin(flow, llm.host);
    expect(result.events).toEqual([{ type: 'error', nodeId: 'asistente', code: 'step_limit_exceeded', message: expect.any(String) }]);
    expectLlmScript(llm, 0);
  });

  it('Al continuar cuenta el llm', async () => {
    const build = (n: number) => {
      const nodes = [llmNode({ slots: undefined, next: n ? 'n0' : 'fin', onExhausted: 'fin' })];
      for (let i = 0; i < n; i++) nodes.push(i % 2 ? jump(`n${i}`, i + 1 < n ? `n${i + 1}` : 'fin') : setNode(`n${i}`, [['x', i]], i + 1 < n ? `n${i + 1}` : 'fin'));
      return flowOf([...nodes, end('fin')], { variables: [variable('x')] });
    };
    const run = async (n: number) => {
      const flow = build(n);
      const llm = scriptedLlm([turn('uno'), turn('listo', {}, true)]);
      const first = await begin(flow, llm.host);
      expect(first.status).toBe('waiting');
      return proceed(flow, first.state, 'hola', llm.host);
    };
    expect((await run(198)).status).toBe('ended');
    const over = await run(199);
    expect(over.status).toBe('failed');
    expect(over.events).toEqual([
      { type: 'message', nodeId: 'a', content: [{ kind: 'text', text: 'listo' }], typingDelayMs: 600 },
      { type: 'llm', nodeId: 'a', turns: 2, costUsd: 0.02, reason: null },
      { type: 'error', nodeId: 'fin', code: 'step_limit_exceeded', message: expect.any(String) },
    ]);
  });
});
