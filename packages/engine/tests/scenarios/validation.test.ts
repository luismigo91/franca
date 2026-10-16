import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { condition, end, flowOf, jump, message, rule, setNode, start, startOk, variable, messageTexts } from '../helpers/flows.js';

describe('Solo se ejecutan flujos válidos', () => {
  it('Flujo con error de forma', async () => {
    const flow = flowOf([message('m', 'Hola', 'fin'), end('fin')]);
    delete flow.start;
    const result = await start(flow);
    expect(result).toMatchObject({ ok: false, code: 'invalid_flow' });
    expect('issues' in result && result.issues).toEqual(validateFlow(flow).issues);
    expect(result).not.toHaveProperty('events');
    expect(result).not.toHaveProperty('state');
  });

  it('Flujo con error semántico', async () => {
    const result = await start(flowOf([jump('j', 'no-existe'), end('fin')]));
    expect(result).toMatchObject({ ok: false, code: 'invalid_flow' });
    expect('issues' in result && result.issues.some((i) => i.layer === 'semantic')).toBe(true);
  });

  it('Versión de formato no soportada', async () => {
    const result = await start(flowOf([end('fin')], { extra: { specVersion: '0.2' } }));
    expect(result).toMatchObject({ ok: false, code: 'invalid_flow' });
  });

  it('un valor que no es un objeto tampoco se ejecuta', async () => {
    for (const bad of [undefined, null, 'flujo', 42, []]) {
      expect(await start(bad)).toMatchObject({ ok: false, code: 'invalid_flow' });
    }
  });
});

describe('Valores de variable y ausencia de valor', () => {
  it('Default null equivale a sin valor', async () => {
    const flow = flowOf(
      [
        condition('c', [[rule('motivo', 'isSet'), 'con-valor']], 'sin-valor'),
        end('con-valor', { outcome: 'con-valor' }),
        end('sin-valor', { outcome: 'sin-valor' }),
      ],
      { variables: [variable('motivo', { default: null })] },
    );
    const result = await startOk(flow);
    expect(result.state.outcome).toBe('sin-valor');
    expect(result.state.variables).toEqual({});
  });

  it('El tipo declarado no se impone', async () => {
    const flow = flowOf(
      [setNode('s', [['edad', 'abc']], 'm'), message('m', '{{edad}}', 'fin'), end('fin')],
      { variables: [variable('edad', { type: 'number' })] },
    );
    const result = await startOk(flow);
    expect(result.status).toBe('ended');
    expect(messageTexts(result.events)).toEqual(['abc']);
  });
});

describe('Forma JSON del flujo', () => {
  it('Default no representable en JSON', async () => {
    const flow = flowOf(
      [
        condition('c', [[rule('n', 'isSet'), 'con-valor']], 'sin-valor'),
        end('con-valor', { outcome: 'con-valor' }),
        end('sin-valor', { outcome: 'sin-valor' }),
      ],
      { variables: [variable('n', { type: 'number', default: Infinity })] },
    );
    const result = await startOk(flow);
    expect(result.state.outcome).toBe('sin-valor');
    expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
  });

  it('Se valida la forma JSON, no el objeto en memoria', async () => {
    const flow = flowOf([
      {
        id: 'm',
        type: 'message',
        content: [{ kind: 'text', text: { toJSON: () => 'Hola' } }],
        next: 'fin',
      },
      end('fin'),
    ]);
    const result = await startOk(flow);
    expect(messageTexts(result.events)).toEqual(['Hola']);
  });

  it('un flujo que no se puede serializar rechaza la promesa (defecto del host)', async () => {
    const flow = flowOf([end('fin')]);
    flow.dato = 1n;
    await expect(start(flow)).rejects.toThrow();
  });
});
