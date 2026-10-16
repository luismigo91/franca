import { describe, expect, it } from 'vitest';
import {
  condition,
  end,
  flowOf,
  message,
  messageTexts,
  rule,
  setNode,
  start,
  startOk,
  variable,
  type Obj,
} from '../helpers/flows.js';
import { startSession, type SessionResult } from '../../src/index.js';

describe('Arranque de sesión', () => {
  it('Se empieza en start, no en el primer nodo de la lista', async () => {
    const flow = flowOf([end('fin'), message('segundo', 'Hola', 'fin')], { start: 'segundo' });
    const result = await startOk(flow);
    expect(result.events[0]).toMatchObject({ type: 'message', nodeId: 'segundo' });
  });

  it('Los defaults inicializan las variables', async () => {
    const flow = flowOf(
      [
        condition('c', [[rule('resuelto', 'eq', false), 'pendiente']], 'otro'),
        end('pendiente', { outcome: 'pendiente' }),
        end('otro', { outcome: 'otro' }),
      ],
      { variables: [variable('resuelto', { type: 'boolean', default: false })] },
    );
    expect((await startOk(flow)).state.outcome).toBe('pendiente');
  });

  it('Variable sin default empieza sin valor', async () => {
    const flow = flowOf([message('m', 'Hola {{nombre}}.', 'fin'), end('fin')], { variables: [variable('nombre')] });
    expect(messageTexts((await startOk(flow)).events)).toEqual(['Hola .']);
  });

  it('Un default json se copia', async () => {
    const flow = flowOf([end('fin')], { variables: [variable('datos', { type: 'json', default: { items: [] } })] });
    const result = await startOk(flow);
    (result.state.variables.datos as { items: unknown[] }).items.push('x');
    expect((flow.variables as Obj[])[0]!.default).toEqual({ items: [] });
    expect((await startOk(flow)).state.variables.datos).toEqual({ items: [] });
  });
});

describe('Valores iniciales de contacto', () => {
  const emailFlow = (extra: Obj[] = []) =>
    flowOf([end('fin'), ...extra], {
      variables: [variable('email', { type: 'email', scope: 'contact', default: 'sin-email' })],
    });

  it('El valor inyectado gana al default', async () => {
    const result = await startOk(emailFlow(), { email: 'ana@example.com' });
    expect(result.state.contact.email).toBe('ana@example.com');
  });

  it('Un valor inyectado null deja el default', async () => {
    expect((await startOk(emailFlow(), { email: null })).state.contact.email).toBe('sin-email');
  });

  it('Se ignoran claves ajenas al flujo', async () => {
    const result = await startOk(emailFlow(), { email: 'ana@example.com', empresa: 'Acme' });
    expect(JSON.stringify(result.state)).not.toContain('empresa');
    expect(Object.keys(result.state.contact)).toEqual(['email']);
  });

  it('No se inyecta en variables de sesión', async () => {
    for (const scope of [{ scope: 'session' }, {}]) {
      const flow = flowOf([end('fin')], { variables: [variable('segmento', { default: 'pyme', ...scope })] });
      const result = await startOk(flow, { segmento: 'empresa' });
      expect(result.state.variables.segmento).toBe('pyme');
    }
  });

  it('Valor de contacto no representable en JSON', async () => {
    for (const bad of [NaN, Infinity, -Infinity, () => 1, new Date(0), undefined, 1n, Symbol('s')]) {
      const result = await start(emailFlow(), { email: bad });
      expect(result, String(bad)).toMatchObject({ ok: false, code: 'invalid_contact' });
      expect(result).not.toHaveProperty('events');
      expect(result).not.toHaveProperty('state');
    }
    const cyclic: Obj = {};
    cyclic.self = cyclic;
    expect(await start(emailFlow(), { email: cyclic })).toMatchObject({ ok: false, code: 'invalid_contact' });
    expect(await start(emailFlow(), { email: [1, , 3] })).toMatchObject({ ok: false, code: 'invalid_contact' }); // eslint-disable-line no-sparse-arrays
  });

  it('Valores de contacto que no son un objeto', async () => {
    for (const bad of [[], ['email'], 'ana@example.com', 5, true, new Date(0), new Map()]) {
      expect(await start(emailFlow(), bad), String(bad)).toMatchObject({ ok: false, code: 'invalid_contact' });
    }
  });

  it('Valores de contacto omitidos o null', async () => {
    const flow = emailFlow();
    for (const result of [
      await startOk(flow),
      await startOk(flow, null),
      await startOk(flow, {}),
      await startSession({ flow }).then((r) => r as SessionResult),
    ]) {
      expect(result.state.contact.email).toBe('sin-email');
    }
  });

  it('Nombres de variable que coinciden con propiedades de Object', async () => {
    const flow = flowOf(
      [
        setNode('s', [['__proto__', 'x']], 'c1'),
        condition('c1', [[rule('constructor', 'isSet'), 'mal1']], 'c2'),
        condition('c2', [[rule('__proto__', 'eq', 'x'), 'm']], 'mal2'),
        message('m', '[{{constructor}}]', 'fin'),
        end('fin', { outcome: 'bien' }),
        end('mal1', { outcome: 'mal1' }),
        end('mal2', { outcome: 'mal2' }),
      ],
      { variables: [variable('constructor'), variable('__proto__')] },
    );
    const result = await startOk(flow);
    expect(messageTexts(result.events)).toEqual(['[]']);
    expect(result.state.outcome).toBe('bien');
    const roundTrip = JSON.parse(JSON.stringify(result.state));
    expect(Object.hasOwn(roundTrip.variables, '__proto__')).toBe(true);
    expect(roundTrip.variables['__proto__']).toBe('x');
    expect(Object.getPrototypeOf(result.state.variables)).toBe(Object.prototype);
    expect(({} as Obj).x).toBeUndefined();
  });

  it('un contacto con la clave __proto__ como propia no contamina el estado', async () => {
    const flow = flowOf([end('fin')], { variables: [variable('__proto__', { scope: 'contact' })] });
    const contact = JSON.parse('{"__proto__": "valor"}');
    const result = await startOk(flow, contact);
    expect(Object.hasOwn(result.state.contact, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(result.state)).contact['__proto__']).toBe('valor');
  });
});

describe('Valores de contacto expuestos en el estado', () => {
  const contactFlow = (value: string | null) =>
    flowOf([setNode('s', [['email', value]], 'fin'), end('fin')], {
      variables: [variable('email', { type: 'email', scope: 'contact' })],
    });

  it('Un set actualiza el valor de contacto', async () => {
    expect((await startOk(contactFlow('nuevo@example.com'))).state.contact).toEqual({ email: 'nuevo@example.com' });
  });

  it('Una variable de contacto vaciada aparece como null', async () => {
    expect((await startOk(contactFlow(null), { email: 'ana@example.com' })).state.contact).toEqual({ email: null });
  });

  it('Las variables de sesión no se exponen como contacto', async () => {
    const flow = flowOf([end('fin')], {
      variables: [variable('segmento', { default: 'pyme' }), variable('email', { scope: 'contact' })],
    });
    const result = await startOk(flow);
    expect(Object.keys(result.state.contact)).toEqual(['email']);
    expect(result.state.variables).toEqual({ segmento: 'pyme' });
  });
});

describe('Ejecución hasta que la sesión se detiene', () => {
  it('Cadena completa hasta el fin', async () => {
    const flow = flowOf(
      [
        message('m', 'Hola', 's'),
        setNode('s', [['segmento', 'pyme']], 'c'),
        condition('c', [[rule('segmento', 'eq', 'pyme'), 'fin']], 'fin'),
        end('fin', { outcome: 'ok' }),
      ],
      { variables: [variable('segmento')] },
    );
    const result = await startOk(flow);
    expect(result.status).toBe('ended');
    expect(result.events.map((e) => e.type)).toEqual(['message', 'end']);
  });
});
