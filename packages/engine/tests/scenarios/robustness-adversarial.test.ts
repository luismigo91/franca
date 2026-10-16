import { describe, expect, it } from 'vitest';
import { continueSession, startSession } from '../../src/index.js';
import { condition, end, flowOf, message, rule, startOk, variable, type Obj } from '../helpers/flows.js';

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

/**
 * BUG (Medium): la spec exige que un flujo no válido se rechace con `invalid_flow`, y los
 * predicados `all`/`any` "pueden anidarse a cualquier profundidad". Con ~1500 niveles de anidamiento
 * `validateFlow` (@franca/spec, recursión de ajv) lanza `RangeError: Maximum call stack size exceeded`
 * y `startSession` rechaza su promesa en lugar de devolver `invalid_flow` o ejecutar el flujo.
 * Origen: packages/engine/src/session.ts (checkFlow, sin captura) sobre packages/spec/src/validate.ts.
 */
describe('Robustez ante anidamiento extremo (defectos conocidos)', () => {
  const deepPredicate = (depth: number): Obj => nest<Obj>(depth, rule('v', 'isSet'), (inner) => ({ all: [inner] }));
  const deepFlow = (depth: number): Obj =>
    flowOf([condition('c', [[deepPredicate(depth), 'fin']], 'fin'), end('fin')], { variables: [variable('v')] });

  it('1000 niveles de predicado anidado se ejecutan', async () => {
    const result = await startOk(deepFlow(1000));
    expect(result.status).toBe('ended');
  });

  it.fails('BUG: 5000 niveles de predicado anidado no deben hacer lanzar a startSession (invalid_flow o ejecución)', async () => {
    const result = await startSession({ flow: deepFlow(5000) });
    expect(typeof result.ok).toBe('boolean');
  });

  it.fails('BUG: un contacto con 100000 niveles de anidamiento no debe hacer lanzar a startSession', async () => {
    const flow = flowOf([end('fin')], { variables: [variable('v', { type: 'json', scope: 'contact' })] });
    const result = await startSession({ flow, contact: { v: nest<unknown>(100000, 1, (inner) => [inner]) } });
    expect(typeof result.ok).toBe('boolean');
  });

  it.fails('BUG: un estado con 100000 niveles de anidamiento no debe hacer lanzar a continueSession (invalid_state)', async () => {
    const flow = flowOf([end('fin')], { id: 'a' });
    const { state } = await startOk(flow);
    const hostil = { ...state, variables: { v: nest<unknown>(100000, 1, (inner) => [inner]) } };
    const result = await continueSession({ flow, state: hostil, input: 'x' });
    expect(result).toMatchObject({ ok: false });
  });

  it('el mismo resultado en dos ejecuciones: 1000 niveles en el contacto se aceptan de forma estable', async () => {
    const flow = flowOf([end('fin')], { variables: [variable('v', { type: 'json', scope: 'contact' })] });
    const contact = { v: nest<unknown>(1000, 1, (inner) => [inner]) };
    const a = await startOk(flow, contact);
    const b = await startOk(flow, contact);
    expect(a).toEqual(b);
  });
});

describe('message: la variable de mensaje vacío', () => {
  it('un message cuyo único texto es una variable sin valor emite un texto vacío (no se omite)', async () => {
    const flow = flowOf([message('m', '{{x}}', 'fin'), end('fin')], { variables: [variable('x')] });
    const event = (await startOk(flow)).events[0]!;
    expect(event.type === 'message' && event.content).toEqual([{ kind: 'text', text: '' }]);
  });
});
