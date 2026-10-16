import { readFileSync } from 'node:fs';
import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { continueSession, startSession } from '../../src/index.js';
import { answerText, reasonOf, reply, replyOk, savedValue, simpleFlow, waiting } from '../helpers/conversation.js';
import { choicesOf, condition, end, flowOf, input, message, messageTexts, rule, setNode, variable } from '../helpers/flows.js';

const leads = (): any => JSON.parse(readFileSync(new URL('../../../spec/examples/captacion-leads.json', import.meta.url), 'utf8'));
const legacyState = (): unknown =>
  JSON.parse(readFileSync(new URL('../legacy/estado-v1-captacion-leads.json', import.meta.url), 'utf8'));

/** Lleva `captacion-leads` hasta la espera de `nodeId` con respuestas válidas. */
async function leadsAt(nodeId: 'pedir-email' | 'pedir-tamano') {
  const flow = leads();
  let { state } = await waiting(flow);
  state = (await replyOk(flow, state, { text: 'Ana' })).state;
  if (nodeId === 'pedir-tamano') state = (await replyOk(flow, state, { text: 'ana@example.com' })).state;
  expect(state.nodeId).toBe(nodeId);
  return { flow, state };
}

const choiceFlow = (extra: Record<string, unknown>, ids = ['a', 'b', 'c'], more: Record<string, unknown>[] = []) =>
  flowOf([input('p', 'v', 'choice', extra.multiple ? 'fin' : undefined, { choices: choicesOf(ids, extra.multiple ? undefined : 'fin'), ...extra }), end('fin', { outcome: 'listo' }), ...more], {
    variables: [variable('v')],
  });

describe('Selección única', () => {
  it('Opción del ejemplo', async () => {
    const { flow, state } = await leadsAt('pedir-tamano');
    const result = await replyOk(flow, state, { choice: 'grande' });
    expect(result.state.variables.tamano).toBe('51+');
    expect(result.state.variables.segmento).toBe('empresa');
    expect(result.events[0]).toMatchObject({ type: 'error', nodeId: 'enviar-crm' }); // pasó por marcar-empresa
  });

  it('Opción sin value y values con tipo', async () => {
    const flow = flowOf(
      [
        input('p', 'v', 'choice', undefined, {
          choices: [
            { id: 'sin-valor', label: 'a', next: 'fin' },
            { id: 'tres', label: 'b', value: 3, next: 'fin' },
            { id: 'si', label: 'c', value: true, next: 'fin' },
          ],
        }),
        end('fin'),
      ],
      { variables: [variable('v')] },
    );
    const { state } = await waiting(flow);
    expect((await replyOk(flow, state, { choice: 'sin-valor' })).state.variables.v).toBe('sin-valor');
    expect((await replyOk(flow, state, { choice: 'tres' })).state.variables.v).toBe(3);
    expect((await replyOk(flow, state, { choice: 'si' })).state.variables.v).toBe(true);
  });

  it('Validación ignorada en selección única', async () => {
    const flow = flowOf(
      [
        input('p', 'v', 'choice', 'otro', {
          validation: { pattern: '(', min: 5, max: 2 },
          choices: [{ id: 'a', label: 'A', next: 'fin' }],
        }),
        end('fin', { outcome: 'de-la-opcion' }),
        end('otro', { outcome: 'del-nodo' }),
      ],
      { variables: [variable('v')] },
    );
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { choice: 'a' });
    expect(result.status).toBe('ended');
    expect(result.state.outcome).toBe('de-la-opcion');
  });
});

describe('Selección múltiple', () => {
  const multi = () =>
    flowOf(
      [
        input('p', 'v', 'choice', 'fin', {
          multiple: true,
          choices: [
            { id: 'a', label: 'A', value: 'A' },
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C', value: 3, next: 'otro' },
          ],
        }),
        end('fin', { outcome: 'del-nodo' }),
        end('otro', { outcome: 'de-la-opcion' }),
      ],
      { variables: [variable('v')] },
    );

  it('Orden del flujo', async () => {
    const flow = multi();
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { choices: ['c', 'b', 'a'] });
    expect(result.state.variables.v).toEqual(['A', 'b', 3]);
    expect(result.state.outcome).toBe('del-nodo');
  });

  it('Selección vacía', async () => {
    const flow = multi();
    const { state } = await waiting(flow);
    expect(reasonOf(await replyOk(flow, state, { choices: [] }))).toBe('required');
  });
});

describe('Límites min y max', () => {
  const reason = async (type: string, text: string, validation: object) => {
    const result = await answerText(type, text, { validation });
    return result.status === 'waiting' ? reasonOf(result) : 'ok';
  };

  it('Longitud de texto en code points', async () => {
    const v = { min: 2, max: 5 };
    expect(await reason('text', 'A', v)).toBe('out_of_range');
    expect(await reason('text', 'Ana', v)).toBe('ok');
    expect(await reason('text', '😀😀', v)).toBe('ok');
    expect(await reason('text', 'abcdef', v)).toBe('out_of_range');
  });

  it('Rango numérico', async () => {
    const v = { min: 18, max: 99 };
    expect(await reason('number', '17', v)).toBe('out_of_range');
    expect(await reason('number', '18', v)).toBe('ok');
    expect(await reason('number', '99', v)).toBe('ok');
    expect(await reason('number', '99,5', v)).toBe('out_of_range');
  });

  it('Número de opciones', async () => {
    const flow = choiceFlow({ multiple: true, validation: { min: 2, max: 3 } }, ['a', 'b', 'c', 'd']);
    const { state } = await waiting(flow);
    const results = [];
    for (const ids of [['a'], ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
      const result = await replyOk(flow, state, { choices: ids });
      results.push(result.status === 'waiting' ? reasonOf(result) : 'ok');
    }
    expect(results).toEqual(['out_of_range', 'ok', 'ok', 'out_of_range']);
  });

  it('Tipos que ignoran los límites', async () => {
    expect(await reason('email', 'ana@example.com', { min: 100 })).toBe('ok');
    expect(await reason('date', '2026-10-16', { max: 1 })).toBe('ok');
  });
});

describe('Patrón de validación', () => {
  const reason = async (type: string, text: string, pattern: string) => {
    const result = await answerText(type, text, { validation: { pattern } });
    return result.status === 'waiting' ? reasonOf(result) : 'ok';
  };

  it('Código postal', async () => {
    expect(await reason('text', '28001', '^\\d{5}$')).toBe('ok');
    expect(await reason('text', '2800', '^\\d{5}$')).toBe('pattern_mismatch');
  });

  it('Se aplica al valor normalizado', async () => {
    expect(await reason('phone', '+34 600 12 34 56', '^\\+34\\d{9}$')).toBe('ok');
    expect(await reason('number', '3,5', '^\\d+\\.\\d+$')).toBe('ok');
  });

  it('Patrón costoso en tiempo lineal', async () => {
    const started = performance.now();
    expect(await reason('text', `${'a'.repeat(4095)}!`, '^(a+)+$')).toBe('pattern_mismatch');
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('el patrón es literal: no se renderiza como plantilla', async () => {
    const flow = flowOf([input('p', 'v', 'text', 'fin', { validation: { pattern: '^\\{\\{a\\}\\}$' } }), end('fin')], {
      variables: [variable('v'), variable('a', { default: 'ana' })],
    });
    const { state } = await waiting(flow);
    expect(reasonOf(await replyOk(flow, state, { text: 'ana' }))).toBe('pattern_mismatch');
    expect((await replyOk(flow, state, { text: '{{a}}' })).state.variables.v).toBe('{{a}}');
  });
});

describe('Orden de comprobación de una respuesta', () => {
  it('El rango gana al patrón', async () => {
    expect(reasonOf(await answerText('number', '5', { validation: { min: 10, pattern: '^1' } }))).toBe('out_of_range');
  });
  it('El formato gana al patrón', async () => {
    expect(reasonOf(await answerText('email', 'ana', { validation: { pattern: '@empresa\\.com$' } }))).toBe('invalid_format');
  });
  it('Vacía gana a los límites', async () => {
    expect(reasonOf(await answerText('text', '   ', { validation: { min: 3 } }))).toBe('required');
  });
});

describe('Reintentos tras una respuesta inválida', () => {
  it('Email inválido en el ejemplo', async () => {
    const { flow, state } = await leadsAt('pedir-email');
    const result = await replyOk(flow, state, { text: 'ana@' });
    expect(result.events).toEqual([
      { type: 'message', nodeId: 'pedir-email', content: [{ kind: 'text', text: 'Ese email no parece válido, ¿lo revisas?' }], typingDelayMs: 600 },
      { type: 'input', nodeId: 'pedir-email', inputType: 'email', attempt: 2, reason: 'invalid_format' },
    ]);
    expect(result.status).toBe('waiting');
    expect(result.state.nodeId).toBe('pedir-email');
    expect(result.state.contact).toEqual({ email: null });
  });

  it('Sin retryMessage se repite el prompt', async () => {
    const flow = flowOf(
      [
        setNode('s', [['nombre', 'Ana']], 'p'),
        input('p', 'n', 'number', 'fin', { prompt: [{ kind: 'text', text: '¿Cuántos sois, {{nombre}}?' }] }),
        end('fin'),
      ],
      { variables: [variable('nombre'), variable('n')] },
    );
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: 'muchos' });
    expect(messageTexts(result.events)).toEqual(['¿Cuántos sois, Ana?']);
    expect(result.events[1]).toMatchObject({ type: 'input', attempt: 2 });
  });

  it('Retry message con plantilla', async () => {
    const flow = flowOf(
      [
        setNode('s', [['nombre', 'Ana']], 'p'),
        input('p', 'v', 'email', 'fin', { validation: { retryMessage: '{{nombre}}, revisa el formato' } }),
        end('fin'),
      ],
      { variables: [variable('nombre'), variable('v')] },
    );
    const { state } = await waiting(flow);
    expect(messageTexts((await replyOk(flow, state, { text: 'no' })).events)).toEqual(['Ana, revisa el formato']);
  });

  it('Tres reintentos por defecto', async () => {
    const flow = simpleFlow('email');
    let { state } = await waiting(flow);
    const attempts: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await replyOk(flow, state, { text: `malo-${i}` });
      expect(result.status).toBe('waiting');
      attempts.push((result.events.find((e) => e.type === 'input') as any).attempt);
      state = result.state;
    }
    expect(attempts).toEqual([2, 3, 4]);
  });

  it('Una respuesta válida tras reintentos', async () => {
    const flow = simpleFlow('email');
    const { state } = await waiting(flow);
    const third = { ...state, attempt: 3 };
    const result = await replyOk(flow, third, { text: 'ana@example.com' });
    expect(result.status).toBe('ended');
    expect(result.state.variables.v).toBe('ana@example.com');
  });

  it('un reintento no modifica ninguna variable', async () => {
    const flow = simpleFlow('email', {}, { variableExtra: { default: 'previo' } });
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: 'no' });
    expect(result.state.variables.v).toBe('previo');
  });
});

describe('Reintentos agotados', () => {
  it('Agotamiento en el ejemplo', async () => {
    const { flow, state } = await leadsAt('pedir-email');
    const first = await replyOk(flow, state, { text: 'a' });
    const second = await replyOk(flow, first.state, { text: 'b' });
    const third = await replyOk(flow, second.state, { text: 'c' });
    expect([first.status, second.status]).toEqual(['waiting', 'waiting']);
    expect(third.events).toEqual([{ type: 'error', nodeId: 'pedir-email', code: 'retries_exhausted', message: expect.any(String) }]);
    expect(third.status).toBe('failed');
    expect(third.state.error).toEqual({ code: 'retries_exhausted', nodeId: 'pedir-email' });
  });

  it('Sin reintentos', async () => {
    const flow = simpleFlow('email', { validation: { maxRetries: 0 } });
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: 'no' });
    expect(result.state.error?.code).toBe('retries_exhausted');
  });

  it('La variable conserva su valor', async () => {
    const flow = simpleFlow('email', { validation: { maxRetries: 0 } }, { variableExtra: { scope: 'contact' } });
    const { state } = await waiting(flow, { v: 'previo@example.com' });
    const result = await replyOk(flow, state, { text: 'no-es-un-email' });
    expect(result.state.contact).toEqual({ v: 'previo@example.com' });
  });
});

describe('Respuesta válida', () => {
  it('Conversación completa del ejemplo', async () => {
    const flow = leads();
    const { state } = await waiting(flow);
    const name = await replyOk(flow, state, { text: ' Ana ' });
    const bad = await replyOk(flow, name.state, { text: 'ana@' });
    const good = await replyOk(flow, bad.state, { text: 'ana@example.com' });
    const last = await replyOk(flow, good.state, { choice: 'grande' });
    expect(messageTexts(name.events)).toEqual(['Encantado, Ana. ¿A qué email te escribimos?']);
    expect(name.events.at(-1)).toMatchObject({ type: 'input', nodeId: 'pedir-email' });
    expect(bad.events.at(-1)).toMatchObject({ attempt: 2 });
    expect(good.events.at(-1)).toMatchObject({ nodeId: 'pedir-tamano', type: 'input' });
    expect(last.status).toBe('failed');
    expect(last.events).toEqual([{ type: 'error', nodeId: 'enviar-crm', code: 'unsupported_node', message: expect.any(String) }]);
    expect(last.state.variables).toEqual({ nombre: 'Ana', tamano: '51+', segmento: 'empresa' });
    expect(last.state.contact).toEqual({ email: 'ana@example.com' });
  });

  it('Dos inputs seguidos', async () => {
    const flow = flowOf([input('a', 'x', 'text', 'b'), input('b', 'y', 'text', 'fin'), end('fin')], { variables: [variable('x'), variable('y')] });
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: 'uno' });
    expect(result.events.map((e) => [e.type, e.nodeId])).toEqual([
      ['message', 'b'],
      ['input', 'b'],
    ]);
    expect(result.events[1]).toMatchObject({ attempt: 1 });
    expect(result.state).toMatchObject({ status: 'waiting', nodeId: 'b', attempt: 1 });
  });

  it('Volver al mismo input reinicia el intento', async () => {
    const flow = flowOf(
      [
        input('a', 'x', 'text', 'c'),
        condition('c', [[rule('x', 'eq', 'otra'), 'a']], 'fin'),
        end('fin'),
      ],
      { variables: [variable('x')] },
    );
    const { state } = await waiting(flow);
    const result = await replyOk(flow, { ...state, attempt: 2 }, { text: 'otra' });
    expect(result.events.at(-1)).toMatchObject({ type: 'input', nodeId: 'a', attempt: 1, reason: null });
    expect(result.state.attempt).toBe(1);
  });

  it('un valor de contacto se refleja en el estado', async () => {
    const flow = simpleFlow('email', {}, { variableExtra: { scope: 'contact' } });
    const { state } = await waiting(flow);
    expect(savedValue(await replyOk(flow, state, { text: 'ana@example.com' }), 'contact')).toBe('ana@example.com');
  });
});

describe('Variables al reanudar', () => {
  it('Variable que el flujo ya no declara', async () => {
    const before = flowOf([input('p', 'v', 'text', 'fin'), end('fin')], { variables: [variable('v'), variable('motivo')] });
    const { state } = await waiting(before);
    const withMotivo = { ...state, variables: { motivo: 'precio' } };
    const after = flowOf([input('p', 'v', 'text', 'fin'), end('fin')], { variables: [variable('v')] });
    const result = await replyOk(after, withMotivo, { text: 'Ana' });
    expect(result.state.variables).toEqual({ v: 'Ana' });
    expect(JSON.stringify(result.state)).not.toContain('motivo');
  });

  it('Variable nueva con default', async () => {
    const before = simpleFlow('text');
    const { state } = await waiting(before);
    const after = flowOf(
      [input('p', 'v', 'text', 'm'), message('m', '[{{extra}}]', 'fin'), end('fin')],
      { variables: [variable('v'), variable('extra', { default: 'x' })] },
    );
    const result = await replyOk(after, state, { text: 'Ana' });
    expect(messageTexts(result.events)).toEqual(['[]']);
  });

  it('Un valor vaciado no resucita', async () => {
    const flow = flowOf(
      [
        setNode('s', [['motivo', null]], 'p'),
        input('p', 'v', 'text', 'c'),
        condition('c', [[rule('motivo', 'isSet'), 'mal']], 'fin'),
        end('fin', { outcome: 'bien' }),
        end('mal', { outcome: 'mal' }),
      ],
      { variables: [variable('v'), variable('motivo', { default: 'precio' })] },
    );
    const { state } = await waiting(flow);
    expect(state.variables).toEqual({});
    const result = await replyOk(flow, state, { text: 'Ana' });
    expect(result.state.outcome).toBe('bien');
  });
});

describe('Las respuestas inválidas no se guardan', () => {
  const MARK = 'ZQXJ-marcador';

  it('Email inválido marcado pii', async () => {
    const flow = simpleFlow('email', {}, { variableExtra: { pii: true } });
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: 'ana@@example.com' });
    expect(JSON.stringify(result.events)).not.toContain('ana@@example.com');
    expect(JSON.stringify(result.state)).not.toContain('ana@@example.com');
  });

  it('Agotamiento sin rastro de las respuestas', async () => {
    const flow = simpleFlow('email', { validation: { maxRetries: 1 } });
    const { state } = await waiting(flow);
    const first = await replyOk(flow, state, { text: 'respuesta-uno' });
    const second = await replyOk(flow, first.state, { text: 'respuesta-dos' });
    for (const result of [first, second]) {
      const text = JSON.stringify([result.events, result.state]);
      expect(text).not.toContain('respuesta-uno');
      expect(text).not.toContain('respuesta-dos');
    }
    expect(second.state.error?.code).toBe('retries_exhausted');
  });

  it('Rechazo sin la entrada', async () => {
    const { flow, state } = await leadsAt('pedir-tamano');
    const result = await reply(flow, state, { choice: 'ana@example.com' });
    expect(result).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(JSON.stringify(result)).not.toContain('ana@example.com');
  });

  it('un marcador único no aparece en ningún evento ni estado de una respuesta inválida', async () => {
    for (const [type, text] of [['email', MARK], ['number', MARK], ['url', `${MARK} x`], ['date', MARK], ['phone', MARK], ['boolean', MARK]] as const) {
      const result = await answerText(type, text);
      expect(JSON.stringify([result.events, result.state]), type).not.toContain(MARK);
    }
    const flow = simpleFlow('text');
    const { state } = await waiting(flow);
    const rejected = await reply(flow, state, { text: 5, [MARK]: 1 });
    expect(JSON.stringify(rejected)).not.toContain(MARK);
  });
});

describe('Compatibilidad del estado', () => {
  it('Estado de la versión anterior', async () => {
    const result = await continueSession({ flow: leads(), state: legacyState(), input: { text: 'Ana' } });
    expect(result).toMatchObject({ ok: false, code: 'session_not_active' });
  });

  it('Estado en espera corrupto', async () => {
    const flow = simpleFlow('text');
    const { state } = await waiting(flow);
    const variants: [string, unknown][] = [
      ['attempt 0', { ...state, attempt: 0 }],
      ['attempt -1', { ...state, attempt: -1 }],
      ['attempt 1.5', { ...state, attempt: 1.5 }],
      ['attempt "2"', { ...state, attempt: '2' }],
      ['sin attempt', (({ attempt: _a, ...rest }) => rest)(state)],
      ['error no null', { ...state, error: { code: 'invalid_rule', nodeId: 'p' } }],
    ];
    for (const [label, bad] of variants) {
      expect(await reply(flow, bad, { text: 'Ana' }), label).toMatchObject({ ok: false, code: 'invalid_state' });
    }
  });

  it('Versión del estado', async () => {
    const { state } = await waiting(simpleFlow('text'));
    expect(state.stateVersion).toBe(1);
  });
});

describe('Un input de selección múltiple necesita next', () => {
  const flowWithoutNext = () => {
    const flow = leads();
    Object.assign(flow.nodes[3], { multiple: true });
    return flow;
  };

  it('Múltiple sin next', async () => {
    const flow = flowWithoutNext();
    const issues = validateFlow(flow).issues;
    expect(issues).toContainEqual({ layer: 'semantic', path: '/nodes/3', nodeId: 'pedir-tamano', message: 'en selección múltiple, el nodo necesita next' });
    expect(await startSession({ flow })).toMatchObject({ ok: false, code: 'invalid_flow' });
  });

  it('Múltiple con next', () => {
    const flow = flowWithoutNext();
    flow.nodes[3].next = 'marcar-pyme';
    expect(validateFlow(flow).valid).toBe(true);
  });
});
