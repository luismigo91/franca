import { describe, expect, it } from 'vitest';
import { startSession } from '../../src/index.js';
import { condition, end, flowOf, httpNode, jump, message, messageTexts, rule, setNode, variable } from '../helpers/flows.js';
import { always, expectScript, respond, scriptedHost, type Step } from '../helpers/http-host.js';
import { continueWith, httpEvents, httpFlow, leads, leadsAtSize, outcomeOf, runOk, withValue } from '../helpers/http-flow.js';

/** Ejecuta `httpFlow` con un host que repite `step` y devuelve el resultado y el host. */
async function runWith(step: Step, request: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, variables: Record<string, unknown>[] = []) {
  const host = always(step);
  const result = await runOk(httpFlow(request, extra, { variables: [variable('v'), ...variables] }), host.host);
  return { result, host };
}

describe('Resultado de un intento', () => {
  it('Propiedades adicionales', async () => {
    const { result, host } = await runWith({ kind: 'response', status: 200, body: '{}', headers: { 'set-cookie': 's=1' } });
    expect(outcomeOf(result)).toBe('ok');
    expectScript(host, 1);
  });

  it('requestSent omitido', async () => {
    const { result, host } = await runWith({ kind: 'network_error' }, { method: 'POST' }, { retries: 2 });
    expectScript(host, 1);
    expect(outcomeOf(result)).toBe('ko');
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 1, status: null, error: 'network_error' }]);
  });
});

describe('Éxito de la llamada', () => {
  it('Códigos 2xx y cuerpos que no son JSON', async () => {
    for (const [status, body] of [[204, ''], [201, '<html>'], [299, '{']] as const) {
      const { result } = await runWith(respond(status, body));
      expect(outcomeOf(result), `${status}`).toBe('ok');
    }
  });
});

describe('Error de la llamada', () => {
  it('Status de error y redirección', async () => {
    for (const status of [404, 301]) {
      const { result } = await runWith(respond(status), {}, { retries: 1 });
      expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 1, status, error: 'http_status' }]);
      expect(outcomeOf(result)).toBe('ko');
    }
  });

  it('Errores sin respuesta', async () => {
    const cases: [unknown, string][] = [
      [{ kind: 'timeout' }, 'timeout'],
      [{ kind: 'blocked' }, 'blocked'],
      [{ kind: 'response_too_large' }, 'response_too_large'],
      [{ kind: 'network_error', requestSent: false }, 'network_error'],
    ];
    for (const [step, error] of cases) {
      const { result } = await runWith(step, {}, { retries: 0 });
      expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 1, status: null, error }]);
    }
  });

  it('Un error no toca las variables', async () => {
    const { result } = await runWith(
      respond(500, '{"id": "T-9"}'),
      {},
      { responseMap: [{ variable: 'ticket', pointer: '/id' }] },
      [withValue('ticket', 'previo')],
    );
    expect(result.state.variables.ticket).toBe('previo');
  });
});

describe('Reintentos', () => {
  it('Reintento por defecto', async () => {
    const host = scriptedHost([respond(503), respond(200)]);
    const result = await runOk(httpFlow({}), host.host);
    expect(host.requests.map((r) => r.attempt)).toEqual([1, 2]);
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 2, status: 200, error: null }]);
    expectScript(host, 2);
  });

  it('Reintentos agotados', async () => {
    const { result, host } = await runWith(respond(503), {}, { retries: 2 });
    expectScript(host, 3);
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 3, status: 503, error: 'http_status' }]);
    expect(outcomeOf(result)).toBe('ko');
  });

  it('Errores que cortan los intentos', async () => {
    for (const step of [respond(404), respond(501), { kind: 'blocked' }, { kind: 'response_too_large' }]) {
      const { host } = await runWith(step, {}, { retries: 5 });
      expectScript(host, 1);
    }
  });

  it('Sin reintentos', async () => {
    const { host } = await runWith(respond(503), {}, { retries: 0 });
    expectScript(host, 1);
  });

  it('Los intentos no cuentan como pasos', async () => {
    for (const kind of ['set', 'jump'] as const) {
      const chain = Array.from({ length: 198 }, (_, i) => {
        const next = i + 1 < 198 ? `n${i + 1}` : 'h';
        return kind === 'set' ? setNode(`n${i}`, [['v', i]], next) : jump(`n${i}`, next);
      });
      const flow = flowOf([...chain, httpNode('h', {}, { retries: 2, next: 'fin', onError: 'fin' }), end('fin')], { variables: [variable('v')] });
      const host = scriptedHost([respond(503), respond(503), respond(200)]);
      const result = await runOk(flow, host.host);
      expect(result.status, kind).toBe('ended');
      expectScript(host, 3);
    }
  });
});

describe('Reintentos e idempotencia', () => {
  it('POST tras un timeout o un 503', async () => {
    for (const step of [{ kind: 'timeout' }, respond(503), { kind: 'network_error', requestSent: true }]) {
      const { result, host } = await runWith(step, { method: 'POST' }, { retries: 2 });
      expectScript(host, 1);
      expect(outcomeOf(result)).toBe('ko');
    }
  });

  it('Errores que se reintentan en cualquier método', async () => {
    const post = scriptedHost([respond(429), respond(408), respond(201)]);
    const postResult = await runOk(httpFlow({ method: 'POST' }, { retries: 2 }), post.host);
    expectScript(post, 3);
    expect(outcomeOf(postResult)).toBe('ok');
    const patch = scriptedHost([{ kind: 'network_error', requestSent: false }, respond(200)]);
    const patchResult = await runOk(httpFlow({ method: 'PATCH' }, { retries: 1 }), patch.host);
    expectScript(patch, 2);
    expect(outcomeOf(patchResult)).toBe('ok');
  });

  it('Métodos idempotentes', async () => {
    const put = scriptedHost([{ kind: 'timeout' }, respond(200)]);
    const del = scriptedHost([respond(500), respond(204)]);
    expect(outcomeOf(await runOk(httpFlow({ method: 'PUT' }, { retries: 1 }), put.host))).toBe('ok');
    expect(outcomeOf(await runOk(httpFlow({ method: 'DELETE' }, { retries: 1 }), del.host))).toBe('ok');
    expectScript(put, 2);
    expectScript(del, 2);
  });

  it('Error del CRM en el ejemplo', async () => {
    const { flow, state } = await leadsAtSize();
    const host = always(respond(500));
    const result = await continueWith(flow, state, { choice: 'pequena' }, host.host);
    expectScript(host, 1);
    expect(result.ok && result.events.map((e) => e.type)).toEqual(['http', 'message', 'end']);
    if (!result.ok) return;
    expect(result.events[0]).toEqual({ type: 'http', nodeId: 'enviar-crm', attempts: 1, status: 500, error: 'http_status' });
    expect(result.events.at(-1)).toMatchObject({ type: 'end', outcome: 'lead-sin-enviar' });
  });
});

describe('Asignación de la respuesta', () => {
  const map = (pointers: [string, string][]) => ({ responseMap: pointers.map(([variable, pointer]) => ({ variable, pointer })) });

  it('Ticket del ejemplo de FAQ', async () => {
    const { result } = await runWith(respond(201, '{"id": "T-1", "eco": "otro"}'), {}, map([['ticket', '/id']]), [variable('ticket')]);
    expect(result.state.variables.ticket).toBe('T-1');
    expect(outcomeOf(result)).toBe('ok');
  });

  it('Tipos y punteros', async () => {
    const body = '{"n": 3, "ok": true, "lista": [1, {"a": "x"}], "o": {"b": null}}';
    const names = ['a', 'b', 'c', 'd', 'e'];
    const { result } = await runWith(respond(200, body), {}, map([['a', '/n'], ['b', '/ok'], ['c', '/lista/1/a'], ['d', '/lista'], ['e', '']]), names.map((n) => variable(n)));
    expect(result.state.variables).toMatchObject({ a: 3, b: true, c: 'x', d: [1, { a: 'x' }], e: JSON.parse(body) });
  });

  it('Punteros que no encuentran nada', async () => {
    const body = '{"n": 3, "ok": true, "lista": [1, {"a": "x"}], "o": {"b": null}}';
    for (const pointer of ['/o/b', '/falta', '/lista/2', '/lista/01', '/lista/-', '/n/x']) {
      const flow = flowOf(
        [
          httpNode('h', {}, { responseMap: [{ variable: 'v', pointer }], next: 'c', onError: 'ko' }),
          condition('c', [[rule('v', 'isSet'), 'mal']], 'ok'),
          end('ok', { outcome: 'ok' }),
          end('mal', { outcome: 'mal' }),
          end('ko', { outcome: 'ko' }),
        ],
        { variables: [withValue('v', 'previo')] },
      );
      const result = await runOk(flow, always(respond(200, body)).host);
      expect(outcomeOf(result), pointer).toBe('ok');
    }
  });

  it('Escapes y nombres de Object', async () => {
    const body = '{"a/b": 1, "m~n": 2, "__proto__": "p"}';
    const { result } = await runWith(respond(200, body), {}, map([['a', '/a~1b'], ['b', '/m~0n'], ['c', '/__proto__'], ['d', '/constructor']]), ['a', 'b', 'c', 'd'].map((n) => variable(n)));
    expect(result.state.variables).toEqual({ a: 1, b: 2, c: 'p' });
  });

  it('Orden y variables de contacto', async () => {
    const flow = httpFlow({}, map([['email', '/a'], ['email', '/b']]), { variables: [variable('email', { scope: 'contact' })] });
    const result = await runOk(flow, always(respond(200, '{"a": "x@example.com", "b": "y@example.com"}')).host);
    expect(result.state.contact).toEqual({ email: 'y@example.com' });
  });
});

describe('Respuesta que no se puede asignar', () => {
  const ticket = { responseMap: [{ variable: 'ticket', pointer: '/id' }] };
  const prior = [withValue('ticket', 'previo')];

  it('Cuerpo que no es JSON', async () => {
    for (const body of ['<html>', '']) {
      const { result, host } = await runWith(respond(200, body), {}, { retries: 2, ...ticket }, prior);
      expectScript(host, 1);
      expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 1, status: 200, error: 'invalid_response' }]);
      expect(outcomeOf(result)).toBe('ko');
      expect(result.state.variables.ticket).toBe('previo');
    }
  });

  it('Todo o nada', async () => {
    const body = JSON.stringify({ a: 'nuevo', b: 'x'.repeat(16385) });
    const { result } = await runWith(respond(200, body), {}, { responseMap: [{ variable: 'a', pointer: '/a' }, { variable: 'b', pointer: '/b' }] }, [withValue('a', 'previo-a'), variable('b')]);
    expect(httpEvents(result)[0]).toMatchObject({ error: 'invalid_response' });
    expect(result.state.variables.a).toBe('previo-a');
  });

  it('Valores que no se pueden guardar', async () => {
    for (const body of ['{"v": "a\\u0000"}', '{"v": "\\ud800"}', '{"v": 1e400}', '{"v": {"k\\u0000": 1}}']) {
      const { result } = await runWith(respond(200, body), {}, { responseMap: [{ variable: 'v', pointer: '/v' }] });
      expect(httpEvents(result)[0], body).toMatchObject({ error: 'invalid_response' });
      expect(outcomeOf(result)).toBe('ko');
    }
  });

  it('Límites de tamaño y profundidad', async () => {
    const chain = (n: number): unknown => { let v: unknown = 1; for (let i = 0; i < n; i++) v = [v]; return v; };
    const cases: [unknown, string][] = [
      ['a'.repeat(16384), 'ok'],
      ['a'.repeat(16385), 'ko'],
      [chain(100), 'ok'],
      [chain(101), 'ko'],
    ];
    for (const [value, outcome] of cases) {
      const { result } = await runWith(respond(200, JSON.stringify({ v: value })), {}, { responseMap: [{ variable: 'v', pointer: '/v' }] });
      expect(outcomeOf(result)).toBe(outcome);
    }
  });

  it('Lo que no se mapea no cuenta', async () => {
    const body = `{"v": "ok", "w": ${'['.repeat(100000)}${']'.repeat(100000)}}`;
    const { result } = await runWith(respond(200, body), {}, { responseMap: [{ variable: 'v', pointer: '/v' }] });
    expect(result.state.variables.v).toBe('ok');
    expect(outcomeOf(result)).toBe('ok');
    expect(() => JSON.stringify(result.state)).not.toThrow();
  });

  it('con un cuerpo de 100000 niveles y puntero vacío, la promesa se resuelve con invalid_response', async () => {
    const body = '['.repeat(100000) + ']'.repeat(100000);
    const { result } = await runWith(respond(200, body), {}, { responseMap: [{ variable: 'v', pointer: '' }] });
    expect(httpEvents(result)[0]).toMatchObject({ error: 'invalid_response' });
  });
});

describe('Tamaño máximo de la respuesta', () => {
  it('Respuesta justo por encima del límite', async () => {
    const ok = await runWith(respond(200, 'a'.repeat(1048576)));
    expect(outcomeOf(ok.result)).toBe('ok');
    const big = await runWith(respond(200, 'a'.repeat(1048577)));
    expect(httpEvents(big.result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 1, status: 200, error: 'response_too_large' }]);
    expect(outcomeOf(big.result)).toBe('ko');
  });

  it('se mide antes de parsear: un cuerpo enorme que no es JSON con responseMap es response_too_large', async () => {
    const { result, host } = await runWith(respond(200, '<'.repeat(1048577)), {}, { retries: 2, responseMap: [{ variable: 'v', pointer: '/id' }] });
    expect(httpEvents(result)[0]).toMatchObject({ status: 200, error: 'response_too_large' });
    expectScript(host, 1);
  });
});

describe('Evento http', () => {
  it('Evento de un éxito', async () => {
    const flow = flowOf([message('m', 'Hola', 'h'), httpNode('h', {}, { next: 'fin', onError: 'fin' }), end('fin')]);
    const result = await runOk(flow, always(respond(200)).host);
    expect(result.events).toEqual([
      { type: 'message', nodeId: 'm', content: [{ kind: 'text', text: 'Hola' }], typingDelayMs: 600 },
      { type: 'http', nodeId: 'h', attempts: 1, status: 200, error: null },
      { type: 'end', nodeId: 'fin', outcome: null },
    ]);
    expect(Object.keys(result.events[1]!)).toEqual(['type', 'nodeId', 'attempts', 'status', 'error']);
  });

  it('Sin evento http cuando la sesión falla', async () => {
    const { result } = await runWith({ kind: 'missing_secret' });
    expect(httpEvents(result)).toEqual([]);
    expect(result.events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('El evento http no cierra la operación', async () => {
    const flow = flowOf([httpNode('h', {}, { next: 'm', onError: 'm' }), message('m', 'Hola', 'fin'), end('fin')]);
    const result = await runOk(flow, always(respond(200)).host);
    expect(result.events.map((e) => e.type)).toEqual(['http', 'message', 'end']);
  });
});

describe('Ejemplo de captación de leads con http', () => {
  it('Conversación completa con éxito', async () => {
    const flow = leads();
    const host = always(respond(201));
    const first = await startSession({ flow }, host.host);
    expect(first.ok && first.status).toBe('waiting');
    if (!first.ok) return;
    const name = await continueWith(flow, first.state, { text: 'Ana' }, host.host);
    const mail = name.ok ? await continueWith(flow, name.state, { text: 'ana@example.com' }, host.host) : name;
    const last = mail.ok ? await continueWith(flow, mail.state, { choice: 'grande' }, host.host) : mail;
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    expect(last.status).toBe('ended');
    expect(last.events[0]).toEqual({ type: 'http', nodeId: 'enviar-crm', attempts: 1, status: 201, error: null });
    expect(messageTexts(last.events)).toEqual(['Gracias, Ana. Alguien del equipo comercial te escribe hoy mismo.']);
    expect(last.events.at(-1)).toMatchObject({ type: 'end', outcome: 'lead-empresa' });
  });

  it('Demasiadas peticiones en el CRM', async () => {
    const { flow, state } = await leadsAtSize();
    const host = always(respond(429));
    const result = await continueWith(flow, state, { choice: 'mediana' }, host.host);
    expectScript(host, 3);
    expect(result.ok && result.state.outcome).toBe('lead-sin-enviar');
  });

  it('con 201 en la rama pyme termina en fin-pyme', async () => {
    const { flow, state } = await leadsAtSize();
    const result = await continueWith(flow, state, { choice: 'pequena' }, always(respond(201)).host);
    expect(result.ok && result.state.outcome).toBe('lead-pyme');
  });
});
