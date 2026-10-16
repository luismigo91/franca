import { describe, expect, it } from 'vitest';
import { MAX_RENDERED_LENGTH } from '../../src/index.js';
import {
  condition,
  end,
  flowOf,
  message,
  messageTexts,
  rule,
  setNode,
  startOk,
  variable,
} from '../helpers/flows.js';

describe('Tamaño máximo de un texto renderizado', () => {
  it('Crecimiento por duplicación', async () => {
    const flow = flowOf(
      [
        setNode('dup', [['a', '{{a}}{{a}}']], 'c'),
        condition('c', [[rule('a', 'eq', 'nunca'), 'fin']], 'dup'),
        end('fin'),
      ],
      { variables: [variable('a', { default: 'x' })] },
    );
    const result = await startOk(flow);
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'dup', code: 'value_too_large', message: expect.any(String) },
    ]);
    expect(result.state.error).toEqual({ code: 'value_too_large', nodeId: 'dup' });
    // 14 ejecuciones completas (2^14 = 16384) y la decimoquinta falla; no es el límite de pasos.
    expect(result.state.variables.a).toHaveLength(MAX_RENDERED_LENGTH);
    expect(JSON.stringify(result.events)).not.toContain('xx');
    expect(JSON.stringify(result.state.error)).not.toContain('xx');
  });

  it('Justo en el límite', async () => {
    const flow = flowOf(
      [message('uno', '{{a}}', 'dos'), message('dos', '{{a}}!', 'fin'), end('fin')],
      { variables: [variable('a', { default: 'y'.repeat(MAX_RENDERED_LENGTH) })] },
    );
    const result = await startOk(flow);
    expect(result.status).toBe('failed');
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ type: 'message', nodeId: 'uno' });
    expect(messageTexts(result.events)[0]).toHaveLength(MAX_RENDERED_LENGTH);
    expect(result.events[1]).toMatchObject({ type: 'error', code: 'value_too_large', nodeId: 'dos' });
  });

  it('Los valores no renderizados no se limitan', async () => {
    const flow = flowOf(
      [condition('c', [[rule('notas', 'isSet'), 'fin']], 'fin'), end('fin')],
      { variables: [variable('notas', { scope: 'contact' })] },
    );
    const notas = 'n'.repeat(20000);
    const result = await startOk(flow, { notas });
    expect(result.status).toBe('ended');
    expect(result.state.contact.notas).toBe(notas);
  });

  it('un set que falla conserva las asignaciones anteriores y no aplica la fallida', async () => {
    const flow = flowOf(
      [setNode('s', [['b', 'ok'], ['c', '{{a}}!'], ['d', 'no']], 'fin'), end('fin')],
      { variables: [variable('a', { default: 'y'.repeat(MAX_RENDERED_LENGTH) }), variable('b'), variable('c'), variable('d')] },
    );
    const result = await startOk(flow);
    expect(result.state.error).toEqual({ code: 'value_too_large', nodeId: 's' });
    expect(result.state.variables.b).toBe('ok');
    expect(result.state.variables).not.toHaveProperty('c');
    expect(result.state.variables).not.toHaveProperty('d');
  });

  it('el texto de un end también está limitado y no se emite', async () => {
    const flow = flowOf([end('fin', { text: '{{a}}!', outcome: 'x' })], {
      variables: [variable('a', { default: 'y'.repeat(MAX_RENDERED_LENGTH) })],
    });
    const result = await startOk(flow);
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'fin', code: 'value_too_large', message: expect.any(String) },
    ]);
  });

  it('url y alt de un elemento multimedia también están limitados', async () => {
    for (const field of ['url', 'alt']) {
      const item = { kind: 'image', url: 'https://example.com/a.png', alt: 'x', [field]: '{{a}}{{a}}' };
      const flow = flowOf([{ id: 'm', type: 'message', content: [item], next: 'fin' }, end('fin')], {
        variables: [variable('a', { default: 'z'.repeat(MAX_RENDERED_LENGTH) })],
      });
      expect((await startOk(flow)).state.error, field).toEqual({ code: 'value_too_large', nodeId: 'm' });
    }
  });
});

describe('Reglas que no se pueden evaluar', () => {
  const withRule = (r: Record<string, unknown>, cp = '28001') =>
    startOk(
      flowOf(
        [condition('c', [[r, 'si']], 'no'), end('si', { outcome: 'si' }), end('no', { outcome: 'no' })],
        { variables: [variable('segmento', { default: 'pyme' }), variable('cp', { default: cp })] },
      ),
    );

  const expectInvalidRule = (result: Awaited<ReturnType<typeof withRule>>) => {
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([
      { type: 'error', nodeId: 'c', code: 'invalid_rule', message: expect.any(String) },
    ]);
    expect(result.state.error).toEqual({ code: 'invalid_rule', nodeId: 'c' });
    expect(result.state.nodeId).toBe('c');
    expect(result.events.some((e) => e.type === 'end')).toBe(false);
  };

  it('Falta value', async () => {
    expectInvalidRule(await withRule(rule('segmento', 'eq')));
  });

  it('Regex inválida', async () => {
    expectInvalidRule(await withRule(rule('cp', 'matches', '(')));
  });

  it('Value no string en matches', async () => {
    expectInvalidRule(await withRule(rule('cp', 'matches', 5)));
  });

  it('Construcción no admitida en matches', async () => {
    for (const pattern of ['(a)\\1', 'a(?=a)', '(?<=a)a', '(?<x>a)|(?<x>b)']) {
      expectInvalidRule(await withRule(rule('cp', 'matches', pattern), 'aa'));
    }
  });

  it('Patrón por encima del tamaño máximo', async () => {
    const admitted = await withRule(rule('cp', 'matches', 'a{1000}'), 'a');
    expect(admitted.status).toBe('ended');
    expect(admitted.state.outcome).toBe('no');
    expectInvalidRule(await withRule(rule('cp', 'matches', 'a{1001}'), 'a'));
    expectInvalidRule(await withRule(rule('cp', 'matches', '(a{40}){40}'), 'a'));
  });

  describe('[critical] tamaño del patrón: lo que se emite cuenta', () => {
    const stacked = (() => {
      let inner = 'a';
      for (let i = 0; i < 98; i++) inner = `(?:${inner})*`;
      return `(?:${inner}){999}b`;
    })();

    it('Alternativas vacías repetidas', async () => {
      for (const pattern of [
        '(?:(?:|){1000}){1000}',
        '(?:(?:|){1000}){1000}a',
        '(?:(?:(?:|){1000}){1000}){1000}a',
      ]) {
        const started = performance.now();
        expectInvalidRule(await withRule(rule('cp', 'matches', pattern), 'a'));
        expect(performance.now() - started, pattern).toBeLessThan(1000);
      }
    });

    it('Cuantificadores apilados', async () => {
      expectInvalidRule(await withRule(rule('cp', 'matches', stacked), 'a'));
    });

    it('Contadores desmesurados', async () => {
      const huge = '9'.repeat(400);
      expect((await withRule(rule('cp', 'matches', `^(?:){${huge}}$`), '')).state.outcome).toBe('si');
      expectInvalidRule(await withRule(rule('cp', 'matches', `a{1,${huge}}`), ''));
    });
  });

  it('Retroceso catastrófico en tiempo lineal', async () => {
    const texto = 'a'.repeat(5000) + '!';
    const result1 = await withRule(rule('cp', 'matches', '^(a+)+$'), texto);
    expect(result1.state.outcome).toBe('no');
    const result2 = await withRule(rule('cp', 'matches', '(a|aa)*!$'), texto);
    expect(result2.state.outcome).toBe('si');
  });

  it('los detalles del error nombran variable y operador pero no el valor', async () => {
    const result = await withRule(rule('cp', 'matches', '('), 'valor-secreto-12345');
    expect(JSON.stringify(result.events)).not.toContain('valor-secreto-12345');
    expect(JSON.stringify(result.events)).toContain('cp');
  });
});
