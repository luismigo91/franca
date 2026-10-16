import { describe, expect, it } from 'vitest';
import { continueSession, startSession } from '../../src/index.js';
import { condition, end, flowOf, input, message, rule, startOk, variable, type Obj } from '../helpers/flows.js';

/** Anida `depth` niveles de `wrap` alrededor de `leaf`. */
function nest<T>(depth: number, leaf: T, wrap: (inner: T) => T): T {
  let value = leaf;
  for (let i = 0; i < depth; i++) value = wrap(value);
  return value;
}

describe('Multimedia: alt definido pero vacío', () => {
  it('un alt "" se emite como alt "" (la spec: alt solo si el flujo lo define)', async () => {
    const flow = flowOf([
      { id: 'm', type: 'message', content: [{ kind: 'image', url: 'https://example.com/a.png', alt: '' }], next: 'fin' },
      end('fin'),
    ]);
    const result = await startOk(flow);
    const event = result.events[0]!;
    expect(event.type === 'message' && event.content[0]).toEqual({
      kind: 'image',
      url: 'https://example.com/a.png',
      alt: '',
    });
  });

  it('un alt con solo una variable sin valor se emite como alt ""', async () => {
    const flow = flowOf(
      [
        { id: 'm', type: 'message', content: [{ kind: 'audio', url: 'u', alt: '{{vacia}}' }], next: 'fin' },
        end('fin'),
      ],
      { variables: [variable('vacia')] },
    );
    const event = (await startOk(flow)).events[0]!;
    expect(event.type === 'message' && event.content[0]).toEqual({ kind: 'audio', url: 'u', alt: '' });
  });
});

describe('Profundidad máxima de anidamiento del patrón de matches', () => {
  const withPattern = (pattern: string) =>
    startOk(
      flowOf([condition('c', [[rule('v', 'matches', pattern), 'si']], 'no'), end('si', { outcome: 'si' }), end('no', { outcome: 'no' })], {
        variables: [variable('v', { default: 'a' })],
      }),
    );
  const groups = (n: number) => '(?:'.repeat(n) + 'a' + ')'.repeat(n);

  it('Patrón demasiado anidado', async () => {
    expect((await withPattern(groups(100))).state.outcome).toBe('si');
    for (const n of [101, 5000, 100000]) {
      const result = await withPattern(groups(n));
      expect(result.state.error, String(n)).toEqual({ code: 'invalid_rule', nodeId: 'c' });
    }
  });

  it('Paréntesis que no abren grupo', async () => {
    const result = await startOk(
      flowOf(
        [
          condition('c1', [[rule('v', 'matches', '\\('.repeat(150)), 'x']], 'c2'),
          condition('c2', [[rule('v', 'matches', '[' + '('.repeat(150) + ']'), 'x']], 'x'),
          end('x'),
        ],
        { variables: [variable('v', { default: '(' })] },
      ),
    );
    expect(result.status).toBe('ended');
  });
});

describe('Patrones de matches demasiado anidados en una sesión', () => {
  it('100000 grupos anidados fallan la sesión con invalid_rule, sin lanzar', async () => {
    const pattern = '(?:'.repeat(100000) + 'a' + ')'.repeat(100000);
    const flow = flowOf([condition('c', [[rule('v', 'matches', pattern), 'fin']], 'fin'), end('fin')], {
      variables: [variable('v', { default: 'a' })],
    });
    const result = await startOk(flow);
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([{ type: 'error', nodeId: 'c', code: 'invalid_rule', message: expect.any(String) }]);
  });
});

describe('Profundidad máxima de anidamiento', () => {
  const deepPredicate = (depth: number): Obj => nest<Obj>(depth, rule('v', 'isSet'), (inner) => ({ all: [inner] }));
  const deepFlow = (depth: number): Obj =>
    flowOf([condition('c', [[deepPredicate(depth), 'fin']], 'fin'), end('fin')], { variables: [variable('v')] });
  const flowWithDefault = (levels: number): Obj =>
    flowOf([end('fin')], { variables: [variable('v', { type: 'json', default: nest<unknown>(levels, 1, (i) => [i]) })] });
  const contactFlow = () => flowOf([end('fin')], { variables: [variable('v', { type: 'json', scope: 'contact' })] });

  it('400 niveles de predicado anidado se ejecutan', async () => {
    expect((await startOk(deepFlow(400))).status).toBe('ended');
  });

  it('Predicado demasiado anidado', async () => {
    for (const depth of [1000, 5000]) {
      const result = await startSession({ flow: deepFlow(depth) });
      expect(result, String(depth)).toMatchObject({ ok: false, code: 'invalid_flow' });
    }
  });

  it('Flujo demasiado anidado', async () => {
    const flow = flowWithDefault(5000);
    for (const result of [
      await startSession({ flow }),
      await continueSession({ flow, state: {}, input: 'x' }),
    ]) {
      expect(result).toMatchObject({ ok: false, code: 'invalid_flow' });
      expect('issues' in result && result.issues).toEqual([
        { layer: 'shape', path: '', message: expect.stringContaining('1000') },
      ]);
    }
  });

  it('un default con 100000 niveles se rechaza sin lanzar', async () => {
    expect(await startSession({ flow: flowWithDefault(100000) })).toMatchObject({ ok: false, code: 'invalid_flow' });
  });

  it('Flujo justo en el límite de anidamiento', async () => {
    // variables (2) + variable (3) + default de n niveles = profundidad 3 + n
    expect((await startOk(flowWithDefault(997))).status).toBe('ended');
    expect(await startSession({ flow: flowWithDefault(998) })).toMatchObject({ ok: false, code: 'invalid_flow' });
  });

  it('un ciclo en memoria se rechaza como demasiado anidado, sin colgarse ni lanzar', async () => {
    const flow = flowOf([end('fin')]);
    flow.self = flow;
    expect(await startSession({ flow })).toMatchObject({ ok: false, code: 'invalid_flow' });
  });

  it('Contacto demasiado anidado', async () => {
    const flow = contactFlow();
    for (const levels of [100000, 1000]) {
      const result = await startSession({ flow, contact: { v: nest<unknown>(levels, 1, (i) => [i]) } });
      expect(result, String(levels)).toMatchObject({ ok: false, code: 'invalid_contact' });
    }
    // contacto (1) + 999 arrays = profundidad 1000
    const ok = await startSession({ flow, contact: { v: nest<unknown>(999, 1, (i) => [i]) } });
    expect(ok.ok).toBe(true);
  });

  it('Estado demasiado anidado', async () => {
    const flow = flowOf([end('fin')], { id: 'a' });
    const { state } = await startOk(flow);
    const hostil = { ...state, variables: { v: nest<unknown>(100000, 1, (inner) => [inner]) } };
    expect(await continueSession({ flow, state: hostil, input: 'x' })).toMatchObject({ ok: false, code: 'invalid_state' });
  });

  it('el mismo resultado en dos ejecuciones: 900 niveles en el contacto se aceptan de forma estable', async () => {
    const contact = { v: nest<unknown>(900, 1, (inner) => [inner]) };
    const a = await startOk(contactFlow(), contact);
    const b = await startOk(contactFlow(), contact);
    expect(a).toEqual(b);
  });
});

describe('Profundidad del estado: ida y vuelta en el límite (D13)', () => {
  const chain = (levels: number): unknown => nest<unknown>(levels, 1, (inner) => [inner]);
  const flowWithInput = () =>
    flowOf([input('p', 'x', 'text', 'fin'), end('fin')], {
      variables: [variable('x'), variable('c', { type: 'json', scope: 'contact' }), variable('s', { type: 'json' })],
    });

  it('Ida y vuelta con un contacto en el límite', async () => {
    const flow = flowWithInput();
    const started = await startSession({ flow, contact: { c: chain(999) } });
    expect(started).toMatchObject({ ok: true, status: 'waiting' });
    if (!started.ok) return;
    for (const state of [started.state, JSON.parse(JSON.stringify(started.state))]) {
      const next = await continueSession({ flow, state, input: { text: 'x' } });
      expect(next, 'continuar con el estado devuelto').toMatchObject({ ok: true, status: 'ended' });
    }
  });

  it('Estado justo en el límite de anidamiento', async () => {
    const flow = flowWithInput();
    const { state } = await startOk(flow);
    for (const field of ['contact', 'variables'] as const) {
      const key = field === 'contact' ? 'c' : 's';
      const at = await continueSession({ flow, state: { ...state, [field]: { [key]: chain(999) } }, input: { text: 'x' } });
      expect(at, `${field} 999`).toMatchObject({ ok: true, status: 'ended' });
      const over = await continueSession({ flow, state: { ...state, [field]: { [key]: chain(1000) } }, input: { text: 'x' } });
      expect(over, `${field} 1000`).toMatchObject({ ok: false, code: 'invalid_state' });
    }
  });

  it('todo estado continuable: cada origen de valores en su máximo, también tras pasar por JSON', async () => {
    // default de una variable: 997 niveles (el flujo tiene profundidad 1000)
    const withDefault = flowOf([input('p', 'x', 'text', 'fin'), end('fin')], {
      variables: [variable('x'), variable('d', { type: 'json', default: chain(997) })],
    });
    // selección múltiple: el valor es un array de escalares
    const multiple = flowOf(
      [input('p', 'x', 'choice', 'q', { multiple: true, choices: [{ id: 'a', label: 'A', value: 1 }] }), input('q', 'y', 'text', 'fin'), end('fin')],
      { variables: [variable('x'), variable('y')] },
    );
    const cases: [string, Obj, unknown, unknown][] = [
      ['default 997', withDefault, undefined, { text: 'x' }],
      ['contacto 999', flowWithInput(), { c: chain(999) }, { text: 'x' }],
      ['selección múltiple', multiple, undefined, { choices: ['a'] }],
    ];
    for (const [label, flow, contact, answer] of cases) {
      const first = await startSession({ flow, contact });
      expect(first.ok && first.status, label).toBe('waiting');
      if (!first.ok) continue;
      const second = await continueSession({ flow, state: JSON.parse(JSON.stringify(first.state)), input: answer });
      expect(second.ok, `${label}: continuar`).toBe(true);
      if (second.ok && second.status === 'waiting') {
        const third = await continueSession({ flow, state: JSON.parse(JSON.stringify(second.state)), input: { text: 'y' } });
        expect(third.ok, `${label}: continuar otra vez`).toBe(true);
      }
    }
  });
});

describe('message: la variable de mensaje vacío', () => {
  it('un message cuyo único texto es una variable sin valor emite un texto vacío (no se omite)', async () => {
    const flow = flowOf([message('m', '{{x}}', 'fin'), end('fin')], { variables: [variable('x')] });
    const event = (await startOk(flow)).events[0]!;
    expect(event.type === 'message' && event.content).toEqual([{ kind: 'text', text: '' }]);
  });
});
