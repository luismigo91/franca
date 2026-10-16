import { describe, expect, it } from 'vitest';
import { continueSession } from '../../src/index.js';
import { chainFlow, end, httpNode, input, llmFlow, llmNode, message, messageTexts, setNode, variable } from '../helpers/flows.js';
import { always, respond } from '../helpers/http-host.js';
import { alwaysLlm, expectLlmScript, failed, refusal, scriptedLlm, turn, withHosts } from '../helpers/llm-host.js';
import { assistantMessage, begin, chat, expectEnded, expectFailed, llmEvent, proceed, waitingInput } from '../helpers/llm-run.js';

const EMAIL = { email: 'ana@example.com' };

describe('Turno que no termina el nodo', () => {
  it('El texto del asistente no es una plantilla', async () => {
    const llm = alwaysLlm(turn('Tu email es {{email}}'));
    const result = await begin(llmFlow(), llm.host, EMAIL);
    expect(result.events[0]).toEqual(assistantMessage('Tu email es {{email}}'));
    expect(JSON.stringify(result.events)).not.toContain('ana@example.com');
  });

  it('Texto recortado y espera', async () => {
    const llm = alwaysLlm(turn('  ¿Me das tu email?\n'));
    const result = await begin(llmFlow({}, { settings: { typingDelayMs: 0 } }), llm.host);
    expect(result.events).toEqual([assistantMessage('¿Me das tu email?', 'a', 0), waitingInput('a')]);
    expect(result.state).toMatchObject({ status: 'waiting', nodeId: 'a', outcome: null, error: null });
    expect(result.state.contact).toEqual({ email: null });
  });
});

describe('Texto del asistente que no se puede emitir', () => {
  it('Textos que no se pueden emitir', async () => {
    for (const text of ['  \n ', 'a'.repeat(4097), 'Hola\u0000', 'Hola\ud800']) {
      const llm = alwaysLlm(turn(text, EMAIL, true, 0.02));
      const result = await begin(llmFlow(), llm.host);
      expect(result.events, JSON.stringify(text.slice(0, 8))).toEqual([llmEvent(1, 0.02, 'invalid_turn'), { type: 'end', nodeId: 'ko', outcome: 'ko' }]);
      expect(result.events.some((e) => e.type === 'message')).toBe(false);
      expect(result.state.contact.email).toBeNull();
    }
  });

  it('Justo en el límite del texto del asistente', async () => {
    const llm = alwaysLlm(turn(` ${'a'.repeat(4096)} `));
    const result = await begin(llmFlow(), llm.host);
    expect(messageTexts(result.events)).toEqual(['a'.repeat(4096)]);
    expect(result.status).toBe('waiting');
  });
});

describe('Mensaje del usuario en un llm', () => {
  const waitingSession = async () => {
    const flow = llmFlow();
    const llm = alwaysLlm(turn('¿Me das tu email?'));
    const first = await begin(flow, llm.host);
    return { flow, llm, state: first.state };
  };

  it('Formas incorrectas en un llm', async () => {
    const { flow, llm, state } = await waitingSession();
    const before = structuredClone(state);
    for (const raw of [{ choice: 'x' }, { text: 5 }, { text: 'Hola', extra: 1 }, 'Hola', undefined]) {
      const result = await continueSession({ flow, state, input: raw }, llm.host);
      expect(result).toMatchObject({ ok: false, code: 'invalid_input' });
    }
    expect(llm.requests).toHaveLength(1);
    expect(state).toEqual(before);
  });

  it('Mensajes del usuario inválidos', async () => {
    const { flow, llm, state } = await waitingSession();
    const cases: [string, string][] = [
      ['a'.repeat(4097), 'too_long'],
      [' \n ', 'required'],
      ['Hola\u0000', 'invalid_format'],
    ];
    for (const [text, reason] of cases) {
      const result = await proceed(flow, state, { text }, llm.host);
      expect(result.events).toEqual([waitingInput('a', 2, reason)]);
      expect(result.state.attempt).toBe(2);
      expect(result.state.conversation).toEqual(state.conversation);
    }
    expect(llm.requests).toHaveLength(1);
  });

  it('Mensaje inválido con slots que el nodo ya no declara', async () => {
    const first = await begin(llmFlow(), alwaysLlm(turn('uno', { email: 'ana@example.com' })).host);
    expect(first.state.conversation?.collected).toEqual({ email: 'ana@example.com' });
    const changed = llmFlow({ slots: undefined });
    const llm = alwaysLlm(turn('no debería llamarse'));
    const result = await proceed(changed, first.state, '   ', llm.host);
    expect(llm.requests).toHaveLength(0);
    expect(result.events).toEqual([waitingInput('a', 2, 'required')]);
    // La conversación vuelve tal como llegó: no se revalidan los recogidos hasta el siguiente mensaje válido.
    expect(result.state.conversation).toEqual(first.state.conversation);
  });

  it('Un mensaje válido tras uno inválido', async () => {
    const { flow, llm, state } = await waitingSession();
    const invalid = await proceed(flow, state, '  ', llm.host);
    expect(invalid.state.attempt).toBe(2);
    const result = await proceed(flow, invalid.state, 'Hola', llm.host);
    expect(llm.requests[1]!.turn).toBe(2);
    expect(result.events[result.events.length - 1]).toEqual(waitingInput('a', 1, null));
  });

  it('Justo en el límite del mensaje del usuario', async () => {
    const { flow, llm, state } = await waitingSession();
    await proceed(flow, state, 'a'.repeat(4096), llm.host);
    expect(llm.requests[1]!.history.at(-1)).toEqual({ role: 'user', text: 'a'.repeat(4096) });
  });
});

describe('Objetivo cumplido', () => {
  it('Objetivo con los slots obligatorios', async () => {
    const llm = alwaysLlm(turn('¡Gracias!', EMAIL, true, 0.01));
    const result = await begin(llmFlow(), llm.host);
    expect(result.events).toEqual([assistantMessage('¡Gracias!'), llmEvent(1, 0.01, null), { type: 'end', nodeId: 'ok', outcome: 'ok' }]);
    expect(result.state.contact.email).toBe('ana@example.com');
  });

  it('Objetivo declarado sin los slots obligatorios', async () => {
    const llm = alwaysLlm(turn('¡Listo!', {}, true));
    const result = await begin(llmFlow(), llm.host);
    expect(result.events).toEqual([assistantMessage('¡Listo!'), waitingInput('a')]);
    expect(result.status).toBe('waiting');
  });

  it('Slots opcionales que faltan', async () => {
    const slots = [
      { variable: 'email', description: 'e' },
      { variable: 'nombre', description: 'n', required: false },
    ];
    const result = await begin(llmFlow({ slots }), alwaysLlm(turn('Hecho', EMAIL, true)).host);
    expectEnded(result, 'ok');
    expect(result.state.variables).toEqual({});
  });

  it('Nodo sin slots', async () => {
    const result = await begin(llmFlow({ slots: undefined }), alwaysLlm(turn('Hecho', {}, true)).host);
    expectEnded(result, 'ok');
  });
});

describe('Límite de turnos de un llm', () => {
  it('Un solo turno', async () => {
    const result = await begin(llmFlow({ maxTurns: 1 }), alwaysLlm(turn('Hola', {}, false, 0.03)).host);
    expect(result.events).toEqual([assistantMessage('Hola'), llmEvent(1, 0.03, 'max_turns'), { type: 'end', nodeId: 'ko', outcome: 'ko' }]);
  });

  it('Turnos agotados', async () => {
    const llm = alwaysLlm(turn('sigo'));
    const results = await chat(llmFlow(), llm.host, ['uno', 'dos']);
    expect(results.map((r) => r.status)).toEqual(['waiting', 'waiting', 'ended']);
    expect(llm.requests).toHaveLength(3);
    expect(results[2]!.events.find((e) => e.type === 'llm')).toMatchObject({ turns: 3, reason: 'max_turns' });
    expectEnded(results[2]!, 'ko');
  });

  it('El objetivo gana en el último turno', async () => {
    const llm = scriptedLlm([turn('uno'), turn('dos'), turn('listo', EMAIL, true)]);
    const results = await chat(llmFlow(), llm.host, ['a', 'b']);
    expectEnded(results[2]!, 'ok');
    expect(results[2]!.events.find((e) => e.type === 'llm')).toMatchObject({ turns: 3, reason: null });
  });

  it('maxTurns rebajado mientras se conversa', async () => {
    const llm = alwaysLlm(turn('sigo'));
    const results = await chat(llmFlow(), llm.host, ['uno']);
    const lowered = llmFlow({ maxTurns: 2 });
    const next = alwaysLlm(turn('no debería llamarse'));
    const result = await proceed(lowered, results[1]!.state, 'Hola', next.host);
    expectLlmScript(next, 0);
    expect(result.events).toEqual([llmEvent(2, 0.02, 'max_turns'), { type: 'end', nodeId: 'ko', outcome: 'ko' }]);
  });

  it('Turnos de un llm y límite de pasos', async () => {
    const flow = chainFlow(198, 'set', llmNode({ slots: undefined }), [end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })]);
    const result = await begin(flow, alwaysLlm(turn('hecho', {}, true)).host);
    expect(result.status).toBe('ended');
  });
});

describe('Tope de coste de un llm', () => {
  it('Coste acumulado por encima del tope', async () => {
    const llm = alwaysLlm(turn('sigo', {}, false, 0.02));
    const results = await chat(llmFlow({ maxTurns: 10, costCapUsd: 0.05 }), llm.host, ['uno', 'dos']);
    expect(results.map((r) => r.status)).toEqual(['waiting', 'waiting', 'ended']);
    expect(results[2]!.events).toEqual([assistantMessage('sigo'), llmEvent(3, 0.06, 'cost_cap'), { type: 'end', nodeId: 'ko', outcome: 'ko' }]);
  });

  it('Coste acumulado igual al tope', async () => {
    const llm = scriptedLlm([turn('uno', {}, false, 0.03), turn('dos', {}, false, 0.02)]);
    const results = await chat(llmFlow({ costCapUsd: 0.05 }), llm.host, ['x']);
    expect(results[1]!.events.find((e) => e.type === 'llm')).toEqual(llmEvent(2, 0.05, 'cost_cap'));
  });

  it('El objetivo gana al tope', async () => {
    const result = await begin(llmFlow({ costCapUsd: 0.05 }), alwaysLlm(turn('listo', EMAIL, true, 0.2)).host);
    expectEnded(result, 'ok');
    expect(result.events.find((e) => e.type === 'llm')).toEqual(llmEvent(1, 0.2, null));
  });

  it('Sin tope de coste', async () => {
    const result = await begin(llmFlow(), alwaysLlm(turn('sigo', {}, false, 1000)).host);
    expect(result.status).toBe('waiting');
  });

  it('Turnos y coste agotados a la vez', async () => {
    const result = await begin(llmFlow({ maxTurns: 1, costCapUsd: 0.01 }), alwaysLlm(turn('sigo', {}, false, 0.02)).host);
    expect(result.events.find((e) => e.type === 'llm')).toMatchObject({ reason: 'max_turns' });
  });
});

describe('Rechazo y fallo del proveedor', () => {
  it('Rechazo en mitad de la conversación', async () => {
    const flow = llmFlow();
    const first = await begin(flow, alwaysLlm(turn('¿Me das tu email?', {}, false, 0.01)).host);
    const llm = alwaysLlm(refusal(0.004));
    const result = await proceed(flow, first.state, 'Hola', llm.host);
    expect(result.events).toEqual([llmEvent(2, 0.014, 'refusal'), { type: 'end', nodeId: 'ko', outcome: 'ko' }]);
    expectLlmScript(llm, 1);
  });

  it('Fallo en el primer turno', async () => {
    const result = await begin(llmFlow(), alwaysLlm(failed(0)).host);
    expect(result.events).toEqual([llmEvent(1, 0, 'provider_error'), { type: 'end', nodeId: 'ko', outcome: 'ko' }]);
  });
});

describe('Salida de un nodo llm', () => {
  it('Agotamiento con slots recogidos', async () => {
    const flow = llmFlow(
      {
        maxTurns: 1,
        slots: [
          { variable: 'email', description: 'e' },
          { variable: 'motivo', description: 'm', required: false },
        ],
      },
      { variables: [variable('email', { type: 'email', scope: 'contact', pii: true }), variable('motivo')] },
    );
    const result = await begin(flow, alwaysLlm(turn('Hola', { motivo: 'precio del envío' }, false)).host, { email: 'previo@example.com' });
    expect(result.events.find((e) => e.type === 'llm')).toMatchObject({ reason: 'max_turns' });
    expect(result.state.variables).toEqual({ motivo: 'precio del envío' });
    expect(result.state.contact).toEqual({ email: 'previo@example.com' });
  });

  it('Orden de los eventos al salir', async () => {
    const flow = llmFlow(
      {},
      { nodes: [llmNode({ next: 'm' }), message('m', 'Fin del asistente', 'ok'), end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })] },
    );
    const result = await begin(flow, alwaysLlm(turn('Gracias', EMAIL, true)).host);
    expect(result.events.map((e) => (e.type === 'end' || e.type === 'llm' || e.type === 'message' ? `${e.type}:${e.nodeId}` : e.type))).toEqual([
      'message:a',
      'llm:a',
      'message:m',
      'end:ok',
    ]);
  });

  it('La conversación no sobrevive a la salida', async () => {
    const nodes = [
      llmNode({ slots: undefined, next: 'p' }),
      input('p', 'nombre', 'text', 'ok'),
      end('ok', { outcome: 'ok' }),
      end('ko', { outcome: 'ko' }),
    ];
    const llm = scriptedLlm([turn('MARCA-TURNO-UNO'), turn('MARCA-TURNO-DOS', {}, true)]);
    const results = await chat(llmFlow({}, { nodes }), llm.host, ['MARCA-CONVERSACION']);
    const last = results[1]!;
    expect(last.status).toBe('waiting');
    expect(last.state.nodeId).toBe('p');
    expect(last.state.conversation).toBeUndefined();
    const serialized = JSON.stringify(last.state);
    for (const marker of ['MARCA-CONVERSACION', 'MARCA-TURNO-UNO', 'MARCA-TURNO-DOS']) expect(serialized).not.toContain(marker);
  });
});

describe('Evento llm', () => {
  it('Forma exacta del evento llm', async () => {
    const llm = scriptedLlm([turn('uno', {}, false, 0.01), turn('dos', EMAIL, true, 0.02)]);
    const results = await chat(llmFlow(), llm.host, ['Hola']);
    const [event] = results[1]!.events.filter((e) => e.type === 'llm');
    expect(event).toEqual({ type: 'llm', nodeId: 'a', turns: 2, costUsd: 0.03, reason: null });
    expect(Object.keys(event!)).toEqual(['type', 'nodeId', 'turns', 'costUsd', 'reason']);
  });
});

describe('Autosalto de un nodo llm', () => {
  // `next` hacia sí mismo y `onExhausted` hacia el único `end`: no hay otra salida.
  const selfJump = (extra: Record<string, unknown> = {}) =>
    llmFlow({}, { nodes: [llmNode({ next: 'a', ...extra }), end('ko', { outcome: 'ko' })] });

  it('Autosalto con turnos conservados', async () => {
    const llm = alwaysLlm(turn('Gracias', EMAIL, true));
    const results = await chat(selfJump(), llm.host, ['uno', 'dos']);
    expect(results[0]!.events).toEqual([assistantMessage('Gracias'), llmEvent(1, 0.01, null), waitingInput('a')]);
    expect(results[0]!.status).toBe('waiting');
    expect(results[0]!.state.contact.email).toBe('ana@example.com');
    expect(results[1]!.events.find((e) => e.type === 'llm')).toMatchObject({ turns: 2, reason: null });
    expect(results[2]!.events).toEqual([assistantMessage('Gracias'), llmEvent(3, 0.03, 'max_turns'), { type: 'end', nodeId: 'ko', outcome: 'ko' }]);
    expect(llm.requests).toHaveLength(3);
    expect(llm.requests[1]!.history[0]).toEqual({ role: 'assistant', text: 'Gracias' });
  });

  it('El autosalto no reinicia el coste', async () => {
    const llm = alwaysLlm(turn('Gracias', EMAIL, true, 0.03));
    const results = await chat(selfJump({ maxTurns: 10, costCapUsd: 0.05 }), llm.host, ['uno']);
    expect(results[0]!.status).toBe('waiting');
    expect(results[1]!.events.filter((e) => e.type === 'llm')).toEqual([llmEvent(2, 0.06, 'cost_cap')]);
    expectEnded(results[1]!, 'ko');
  });
});

describe('Volver a un llm desde otro nodo', () => {
  it('Ciclo con otro nodo', async () => {
    const flow = llmFlow(
      {},
      { nodes: [llmNode({ slots: undefined, next: 'b' }), setNode('b', [['nombre', 'x']], 'a'), end('ko', { outcome: 'ko' })] },
    );
    const llm = alwaysLlm(turn('listo', {}, true));
    const result = await begin(flow, llm.host);
    expect(llm.requests).toHaveLength(10);
    for (const request of llm.requests) expect(request).toMatchObject({ turn: 1, history: [] });
    expectFailed(result, 'llm_limit_exceeded', 'a');
  });
});

describe('Orden de comprobación de un nodo llm', () => {
  it('La capacidad se comprueba antes que el mensaje', async () => {
    const flow = llmFlow();
    const first = await begin(flow, alwaysLlm(turn('Hola')).host);
    const result = await proceed(flow, first.state, { text: '' }, {});
    expectFailed(result, 'unsupported_node', 'a');
  });

  it('System demasiado largo', async () => {
    const flow = llmFlow(
      { system: '{{t}}!' },
      {
        variables: [variable('email', { type: 'email', scope: 'contact', pii: true }), variable('t', { default: 'x'.repeat(16384) })],
        nodes: [message('m', 'previo', 'a'), llmNode({ system: '{{t}}!' }), end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })],
      },
    );
    const llm = alwaysLlm(turn('Hola'));
    const result = await begin(flow, llm.host);
    expect(result.events.map((e) => e.type)).toEqual(['message', 'error']);
    expectFailed(result, 'value_too_large', 'a');
    expectLlmScript(llm, 0);
  });

  it('El mensaje inválido gana al agotamiento', async () => {
    const flow = llmFlow();
    const results = await chat(flow, alwaysLlm(turn('sigo')).host, ['uno']);
    const lowered = llmFlow({ maxTurns: 2 });
    const result = await proceed(lowered, results[1]!.state, '  ', alwaysLlm(turn('no debería llamarse')).host);
    expect(result.status).toBe('waiting');
    expect(result.events).toEqual([waitingInput('a', 2, 'required')]);
  });
});

describe('Turnos de llm en el límite de llamadas', () => {
  const chainToLlm = (count: number) => {
    const nodes = [
      ...Array.from({ length: count }, (_, i) => httpNode(`h${i}`, {}, { retries: 0, next: i + 1 < count ? `h${i + 1}` : 'a', onError: i + 1 < count ? `h${i + 1}` : 'a' })),
      llmNode(),
      end('ok', { outcome: 'ok' }),
      end('ko', { outcome: 'ko' }),
    ];
    return llmFlow({}, { nodes });
  };

  it('Diez llamadas http antes de un llm', async () => {
    const llm = alwaysLlm(turn('Hola'));
    const { host } = withHosts(always(respond(200)).host, llm.host);
    const result = await begin(chainToLlm(10), host);
    expect(result.events.map((e) => e.type)).toEqual([...Array(10).fill('http'), 'error']);
    expectFailed(result, 'llm_limit_exceeded', 'a');
    expectLlmScript(llm, 0);
  });

  it('El presupuesto se reinicia al continuar en un llm', async () => {
    const flow = chainToLlm(9);
    const llm = alwaysLlm(turn('Hola'));
    const http = always(respond(200));
    const { host } = withHosts(http.host, llm.host);
    const first = await begin(flow, host);
    expect(http.requests).toHaveLength(9);
    expect(first.status).toBe('waiting');
    expect(first.state.nodeId).toBe('a');
    const second = await proceed(flow, first.state, 'Hola', host);
    expect(second.status).toBe('waiting');
    expect(second.events.some((e) => e.type === 'error')).toBe(false);
    expectLlmScript(llm, 2);
  });
});
