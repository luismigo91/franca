import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  condition,
  end,
  flowOf,
  http,
  jump,
  message,
  messageTexts,
  rule,
  setNode,
  startOk,
  variable,
  type Obj,
} from '../helpers/flows.js';

describe('Eventos de salida', () => {
  it('El fin es el último evento', async () => {
    const flow = flowOf([message('a', 'Uno', 'b'), message('b', 'Dos', 'fin'), end('fin')]);
    const result = await startOk(flow);
    expect(result.events.map((e) => e.type)).toEqual(['message', 'message', 'end']);
  });

  it('El error es el último evento', async () => {
    const flow = flowOf([message('a', 'Uno', 'h'), http('h', 'fin', 'fin'), end('fin')]);
    const result = await startOk(flow);
    expect(result.events.at(-1)).toMatchObject({ type: 'error' });
    expect(result.events.some((e) => e.type === 'end')).toBe(false);
  });

  it('los eventos tienen la forma del contrato', async () => {
    const flow = flowOf([message('a', 'Hola', 'fin'), end('fin', { outcome: 'listo' })]);
    expect((await startOk(flow)).events).toEqual([
      { type: 'message', nodeId: 'a', content: [{ kind: 'text', text: 'Hola' }], typingDelayMs: 600 },
      { type: 'end', nodeId: 'fin', outcome: 'listo' },
    ]);
  });
});

describe('Retardo de escritura expuesto en los mensajes', () => {
  const delayOf = async (settings?: Obj) =>
    (await startOk(flowOf([message('a', 'Hola', 'fin'), end('fin')], { settings }))).events[0];

  it('Retardo definido en el flujo', async () => {
    expect(await delayOf({ typingDelayMs: 400 })).toMatchObject({ typingDelayMs: 400 });
  });

  it('Retardo por defecto', async () => {
    expect(await delayOf()).toMatchObject({ typingDelayMs: 600 });
  });

  it('Retardo cero', async () => {
    expect(await delayOf({ typingDelayMs: 0 })).toMatchObject({ typingDelayMs: 0 });
  });

  it('El retardo también llega en el message de un end', async () => {
    const flow = flowOf([end('fin', { text: 'Adiós' })], { settings: { typingDelayMs: 250 } });
    expect((await startOk(flow)).events[0]).toMatchObject({ type: 'message', typingDelayMs: 250 });
  });

  describe('con temporizadores simulados', () => {
    afterEach(() => vi.useRealTimers());

    it('El motor no espera', async () => {
      vi.useFakeTimers();
      const flow = flowOf(
        [message('a', '1', 'b'), message('b', '2', 'c'), message('c', '3', 'fin'), end('fin')],
        { settings: { typingDelayMs: 10000 } },
      );
      const result = await startOk(flow);
      expect(result.status).toBe('ended');
      expect(result.events).toHaveLength(4);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe('Nodo message', () => {
  it('Varios elementos en un solo evento', async () => {
    const flow = flowOf([
      {
        id: 'm',
        type: 'message',
        content: [
          { kind: 'text', text: 'Mira' },
          { kind: 'image', url: 'https://example.com/a.png' },
        ],
        next: 'fin',
      },
      end('fin'),
    ]);
    const messages = (await startOk(flow)).events.filter((e) => e.type === 'message');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      content: [
        { kind: 'text', text: 'Mira' },
        { kind: 'image', url: 'https://example.com/a.png' },
      ],
    });
  });

  it('Multimedia con plantillas', async () => {
    const flow = flowOf(
      [
        setNode('s', [['nombre', 'Ana']], 'm'),
        {
          id: 'm',
          type: 'message',
          content: [{ kind: 'image', url: 'https://example.com/{{nombre}}.png', alt: 'Foto de {{nombre}}' }],
          next: 'fin',
        },
        end('fin'),
      ],
      { variables: [variable('nombre')] },
    );
    const event = (await startOk(flow)).events[0];
    expect(event).toMatchObject({
      content: [{ kind: 'image', url: 'https://example.com/Ana.png', alt: 'Foto de Ana' }],
    });
  });

  it('Multimedia sin alt', async () => {
    const flow = flowOf([
      { id: 'm', type: 'message', content: [{ kind: 'video', url: 'https://example.com/v.mp4' }], next: 'fin' },
      end('fin'),
    ]);
    const event = (await startOk(flow)).events[0] as { content: Obj[] };
    expect(event.content[0]).toEqual({ kind: 'video', url: 'https://example.com/v.mp4' });
    expect('alt' in event.content[0]!).toBe(false);
  });
});

describe('Nodo set', () => {
  it('Asignaciones secuenciales', async () => {
    const flow = flowOf([setNode('s', [['a', 'x'], ['b', '{{a}}-y']], 'fin'), end('fin')], {
      variables: [variable('a'), variable('b')],
    });
    expect((await startOk(flow)).state.variables).toEqual({ a: 'x', b: 'x-y' });
  });

  it('Literales con tipo', async () => {
    const flow = flowOf(
      [
        setNode('s', [['n', 3], ['ok', true]], 'c1'),
        condition('c1', [[rule('n', 'gt', 2), 'c2']], 'mal'),
        condition('c2', [[rule('ok', 'eq', true), 'fin']], 'mal'),
        end('fin', { outcome: 'bien' }),
        end('mal', { outcome: 'mal' }),
      ],
      { variables: [variable('n', { type: 'number' }), variable('ok', { type: 'boolean' })] },
    );
    const { state } = await startOk(flow);
    expect(state.outcome).toBe('bien');
    expect(state.variables.n).toBe(3);
    expect(typeof state.variables.n).toBe('number');
    expect(state.variables.ok).toBe(true);
  });

  it('Un string con plantilla produce texto', async () => {
    const flow = flowOf([setNode('s', [['n', 3], ['copia', '{{n}}']], 'fin'), end('fin')], {
      variables: [variable('n', { type: 'number' }), variable('copia')],
    });
    expect((await startOk(flow)).state.variables.copia).toBe('3');
  });

  it('Null vacía la variable', async () => {
    const flow = flowOf(
      [
        setNode('s', [['motivo', null]], 'c'),
        condition('c', [[rule('motivo', 'isSet'), 'mal']], 'fin'),
        end('fin', { outcome: 'bien' }),
        end('mal', { outcome: 'mal' }),
      ],
      { variables: [variable('motivo', { default: 'precio' })] },
    );
    const { state } = await startOk(flow);
    expect(state.outcome).toBe('bien');
    expect(state.variables).toEqual({});
  });

  it('Set no emite eventos', async () => {
    const flow = flowOf([setNode('s', [['a', 1]], 'fin'), end('fin')], { variables: [variable('a')] });
    expect((await startOk(flow)).events).toEqual([{ type: 'end', nodeId: 'fin', outcome: null }]);
  });
});

describe('Nodo jump', () => {
  it('Salto transparente', async () => {
    const flow = flowOf([jump('j', 'm'), message('m', 'Hola', 'fin'), end('fin')], { variables: [variable('v', { default: 'a' })] });
    const result = await startOk(flow);
    expect(result.events.map((e) => e.type)).toEqual(['message', 'end']);
    expect(result.events[0]).toMatchObject({ nodeId: 'm' });
    expect(result.state.variables).toEqual({ v: 'a' });
  });
});

describe('Nodo condition', () => {
  const routed = (rules: [Obj, string][], variables: Obj[] = [variable('v', { default: 'a' })]) =>
    startOk(
      flowOf(
        [
          condition('c', rules, 'el-else'),
          end('a', { outcome: 'a' }),
          end('b', { outcome: 'b' }),
          end('el-else', { outcome: 'else' }),
        ],
        { variables },
      ),
    );

  it('Gana la primera regla verdadera', async () => {
    const result = await routed([[rule('v', 'eq', 'a'), 'a'], [rule('v', 'isSet'), 'b']]);
    expect(result.state.outcome).toBe('a');
  });

  it('Ninguna regla verdadera', async () => {
    const result = await routed([[rule('v', 'eq', 'z'), 'a'], [rule('v', 'eq', 'y'), 'b']]);
    expect(result.state.outcome).toBe('else');
  });

  it('Las reglas posteriores a la ganadora no se evalúan', async () => {
    const result = await routed([[rule('v', 'eq', 'a'), 'a'], [rule('v', 'matches', '('), 'b']]);
    expect(result.status).toBe('ended');
    expect(result.state.outcome).toBe('a');
    expect(result.events.some((e) => e.type === 'error')).toBe(false);
  });

  it('el condition no emite eventos', async () => {
    const result = await routed([[rule('v', 'eq', 'a'), 'a'], [rule('v', 'eq', 'z'), 'b']]);
    expect(result.events.map((e) => e.type)).toEqual(['end']);
  });
});

describe('Predicados en un condition', () => {
  it('all y any anidados se evalúan en la sesión', async () => {
    const flow = flowOf(
      [
        condition(
          'c',
          [[{ any: [{ all: [rule('a', 'eq', 1), rule('b', 'eq', 3)] }, { all: [rule('a', 'eq', 1), rule('b', 'eq', 2)] }] }, 'si']],
          'no',
        ),
        end('si', { outcome: 'si' }),
        end('no', { outcome: 'no' }),
      ],
      { variables: [variable('a', { default: 1 }), variable('b', { default: 2 })] },
    );
    expect((await startOk(flow)).state.outcome).toBe('si');
  });
});

describe('Nodo end', () => {
  it('Fin con contenido y outcome', async () => {
    const flow = flowOf(
      [setNode('s', [['nombre', 'Ana']], 'fin'), end('fin', { outcome: 'lead-pyme', text: 'Gracias, {{nombre}}.' })],
      { variables: [variable('nombre')] },
    );
    const result = await startOk(flow);
    expect(result.events).toEqual([
      { type: 'message', nodeId: 'fin', content: [{ kind: 'text', text: 'Gracias, Ana.' }], typingDelayMs: 600 },
      { type: 'end', nodeId: 'fin', outcome: 'lead-pyme' },
    ]);
    expect(result.state).toMatchObject({ status: 'ended', outcome: 'lead-pyme', nodeId: 'fin', error: null });
  });

  it('Fin sin contenido ni outcome', async () => {
    const result = await startOk(flowOf([end('fin')]));
    expect(result.events).toEqual([{ type: 'end', nodeId: 'fin', outcome: null }]);
    expect(result.state.outcome).toBeNull();
  });

  it('el texto de un end usa los valores de las variables', async () => {
    const flow = flowOf([end('fin', { text: '{{x}}' })], { variables: [variable('x', { default: 'valor' })] });
    expect(messageTexts((await startOk(flow)).events)).toEqual(['valor']);
  });
});
