import { llmFlow, llmNode } from '../helpers/flows.js';
import { alwaysLlm, turn, withHosts } from '../helpers/llm-host.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSession } from '../../src/index.js';
import { condition, end, flowOf, httpNode, input, rule, setNode, variable } from '../helpers/flows.js';
import { ClassHost, always, expectScript, getterHost, rejectingHost, respond, scriptedHost, throwingHost } from '../helpers/http-host.js';
import { continueWith, expectFailure, httpEvents, httpFlow, leadsAtSize, outcomeOf, runOk, withValue } from '../helpers/http-flow.js';

describe('Capacidad http del host', () => {
  it('Una llamada por intento', async () => {
    const host = always(respond(200));
    const flow = httpFlow({ method: 'GET', url: 'https://api.example.com/x' }, { retries: 0 });
    const result = await runOk(flow, host.host);
    expectScript(host, 1);
    expect(host.requests[0]!.attempt).toBe(1);
    expect(outcomeOf(result)).toBe('ok');
  });

  it('Un flujo sin http no llama al host', async () => {
    const host = always(respond(200));
    const flow = flowOf([{ id: 'm', type: 'message', content: [{ kind: 'text', text: 'Hola' }], next: 'fin' }, end('fin')]);
    await runOk(flow, host.host);
    expectScript(host, 0);
  });

  it('Capacidad que no es una función', async () => {
    const flow = flowOf([setNode('s', [['v', 'x']], 'h'), httpNode('h', {}, { next: 'fin', onError: 'fin' }), end('fin')], { variables: [variable('v')] });
    for (const bad of ['no', 5, true, {}, null]) {
      const result = await runOk(flow, { http: bad } as never);
      expectFailure(result, 'unsupported_node');
    }
  });

  it('Llamadas en secuencia', async () => {
    const log: string[] = [];
    const step = async (request: { nodeId: string }) => {
      log.push(`inicio:${request.nodeId}`);
      await Promise.resolve();
      await Promise.resolve();
      log.push(`fin:${request.nodeId}`);
      return respond(200);
    };
    const host = scriptedHost([step as never, step as never]);
    const flow = flowOf([httpNode('a', {}, { next: 'b', onError: 'b' }), httpNode('b', {}, { next: 'fin', onError: 'fin' }), end('fin')]);
    await runOk(flow, host.host);
    expect(host.maxInFlight).toBe(1);
    expect(log).toEqual(['inicio:a', 'fin:a', 'inicio:b', 'fin:b']);
  });
});

describe('Lectura de la capacidad http', () => {
  const flow = () => flowOf([setNode('s', [['v', 'x']], 'h'), httpNode('h', {}, { next: 'fin', onError: 'fin' }), end('fin')], { variables: [variable('v')] });

  it('Host omitido o nulo', async () => {
    const omitted = await startSession({ flow: flow() });
    const nulled = await startSession({ flow: flow() }, null);
    for (const result of [omitted, nulled]) {
      expect(result.ok).toBe(true);
      if (result.ok) expectFailure(result, 'unsupported_node');
    }
  });

  it('Host con métodos', async () => {
    const host = new ClassHost();
    const result = await runOk(httpFlow({}, { retries: 1 }), host);
    expect(outcomeOf(result)).toBe('ok');
    expect(host.calls).toBe(1);
    expect(host.receivers[0]).toBe(host);
  });

  it('un nodo lee el host una vez aunque haga tres intentos, y dos llegadas leen dos veces', async () => {
    const steps = scriptedHost([respond(503), respond(503), respond(200)]);
    const getter = getterHost({ capability: steps.host.http });
    await runOk(httpFlow({}, { retries: 2 }), getter.host);
    expect(getter.reads()).toBe(1);
    const twice = getterHost({ capability: always(respond(200)).host.http });
    const flow = flowOf([httpNode('a', {}, { next: 'b', onError: 'b' }), httpNode('b', {}, { next: 'fin', onError: 'fin' }), end('fin')]);
    await runOk(flow, twice.host);
    expect(twice.reads()).toBe(2);
  });
});

describe('Orden de comprobación de un nodo http', () => {
  const big = withValue('a', 'a'.repeat(16385));

  it('La capacidad se comprueba antes que la configuración', async () => {
    const result = await runOk(httpFlow({ headers: { 'X Bad': 'v' } }), {});
    expectFailure(result, 'unsupported_node');
  });

  it('La configuración gana al tamaño', async () => {
    const host = always(respond(200));
    const result = await runOk(httpFlow({ headers: { 'X Bad': 'x', 'X-Ok': '{{a}}' } }, {}, { variables: [big] }), host.host);
    expectFailure(result, 'invalid_http_config');
    expectScript(host, 0);
  });

  it('El tamaño gana a la URL inválida', async () => {
    const host = always(respond(200));
    const result = await runOk(httpFlow({ url: 'ftp://api.example.com/', headers: { 'X-Ok': '{{a}}' } }, {}, { variables: [big] }), host.host);
    expectFailure(result, 'value_too_large');
    expect(httpEvents(result)).toEqual([]);
    expectScript(host, 0);
  });

  it('el límite de pasos va antes que la capacidad', async () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, type: 'jump', target: i + 1 < 200 ? `n${i + 1}` : 'h' }));
    const flow = flowOf([...nodes, httpNode('h', {}, { next: 'fin', onError: 'fin' }), end('fin')]);
    const result = await runOk(flow, {});
    expectFailure(result, 'step_limit_exceeded');
  });
});

describe('Resultado del host fuera de contrato', () => {
  it('El host rechaza con un mensaje sensible', async () => {
    const reject = rejectingHost(new Error('fallo en https://api.example.com/?e=ana@example.com'));
    const flow = httpFlow({ url: 'https://api.example.com/?e={{email}}' }, { retries: 3 }, { variables: [withValue('email', 'ana@example.com', { pii: true })] });
    const result = await runOk(flow, reject.host);
    expectFailure(result, 'http_host_error');
    expect(reject.calls()).toBe(1);
    expect(JSON.stringify(result.events)).not.toContain('ana@example.com');
    expect(JSON.stringify(result.state.error)).not.toContain('ana@example.com');
  });

  it('Resultados mal formados', async () => {
    const boom = { get kind(): never { throw new Error('boom'); } };
    const bad: unknown[] = [
      null,
      { kind: 'otro' },
      { kind: 'response', status: 199, body: '' },
      { kind: 'response', status: 600, body: '' },
      { kind: 'response', status: 200.5, body: '' },
      { kind: 'response', status: 200, body: 5 },
      { kind: 'network_error', requestSent: 'no' },
      boom,
    ];
    for (const value of bad) {
      const host = always(value);
      const result = await runOk(httpFlow({}, { retries: 2 }), host.host);
      expectFailure(result, 'http_host_error');
      expectScript(host, 1);
      expect(httpEvents(result)).toEqual([]);
    }
    const sync = throwingHost();
    expectFailure(await runOk(httpFlow({}, { retries: 2 }), sync.host), 'http_host_error');
    expect(sync.calls()).toBe(1);
  });

  it('Capacidad que lanza al leerla', async () => {
    const result = await runOk(httpFlow(), getterHost({ throws: true }).host);
    expectFailure(result, 'http_host_error');
  });

  it('un host que resuelve un valor síncrono también funciona', async () => {
    const host = { http: (() => respond(200)) as never };
    expect(outcomeOf(await runOk(httpFlow(), host))).toBe('ok');
  });
});

describe('Secreto no disponible', () => {
  it('Secreto que falta en el ejemplo', async () => {
    const { flow, state } = await leadsAtSize();
    const host = always({ kind: 'missing_secret' });
    const result = await continueWith(flow, state, { choice: 'grande' }, host.host);
    expect(result.ok && result.status).toBe('failed');
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'error', nodeId: 'enviar-crm', code: 'missing_secret', message: expect.any(String) }]);
    expectScript(host, 1);
  });

  it('no reintenta, no sigue por onError y no emite el evento http', async () => {
    const host = always({ kind: 'missing_secret' });
    const result = await runOk(httpFlow({}, { retries: 5 }), host.host);
    expectFailure(result, 'missing_secret');
    expect(httpEvents(result)).toEqual([]);
    expectScript(host, 1);
  });
});

describe('Tiempo de espera y pausas', () => {
  afterEach(() => vi.useRealTimers());

  it('Respuesta que llega tarde', async () => {
    vi.useFakeTimers();
    const late = async () => {
      vi.advanceTimersByTime(60000);
      return respond(200);
    };
    const host = scriptedHost([late as never]);
    const result = await runOk(httpFlow({}, { timeoutMs: 1000 }), host.host);
    expect(outcomeOf(result)).toBe('ok');
    expect(host.requests[0]!.timeoutMs).toBe(1000);
  });

  it('El motor no espera entre reintentos', async () => {
    vi.useFakeTimers();
    const host = scriptedHost([respond(503), respond(503), respond(200)]);
    const result = await runOk(httpFlow({}, { retries: 2 }), host.host);
    expect(outcomeOf(result)).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
    expectScript(host, 3);
  });
});

describe('Límite de llamadas al host por avance', () => {
  const chainOf = (length: number, tail: Record<string, unknown>[]) =>
    flowOf(
      [
        ...Array.from({ length }, (_, i) => httpNode(`h${i + 1}`, {}, { next: i + 1 < length ? `h${i + 2}` : 'p', onError: i + 1 < length ? `h${i + 2}` : 'p' })),
        ...tail,
      ],
      { variables: [variable('v')] },
    );

  it('Ciclo de llamadas', async () => {
    const flow = flowOf(
      [httpNode('h', {}, { next: 'c', onError: 'c' }), condition('c', [[rule('v', 'eq', 'nunca'), 'fin']], 'h'), end('fin')],
      { variables: [variable('v')] },
    );
    const host = always(respond(200));
    const result = await runOk(flow, host.host);
    expect(result.events.filter((e) => e.type === 'http')).toHaveLength(10);
    expect(result.events.at(-1)).toMatchObject({ type: 'error', code: 'http_limit_exceeded', nodeId: 'h' });
    expectScript(host, 10);
    expect(result.events.map((e) => e.type).slice(0, 10).every((t) => t === 'http')).toBe(true);
  });

  it('Reintentos recortados por el límite', async () => {
    const flow = flowOf([httpNode('a', {}, { retries: 5, next: 'b', onError: 'b' }), httpNode('b', {}, { retries: 5, next: 'ok', onError: 'ko' }), end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })]);
    const host = always(respond(503));
    const result = await runOk(flow, host.host);
    expect(httpEvents(result)).toEqual([
      { type: 'http', nodeId: 'a', attempts: 6, status: 503, error: 'http_status' },
      { type: 'http', nodeId: 'b', attempts: 4, status: 503, error: 'http_status' },
    ]);
    expect(outcomeOf(result)).toBe('ko');
    expectScript(host, 10);
  });

  it('El contador se reinicia al continuar', async () => {
    const flow = chainOf(10, [input('p', 'v', 'text', 'h11'), httpNode('h11', {}, { next: 'fin', onError: 'fin' }), end('fin')]);
    const host = always(respond(200));
    const started = await runOk(flow, host.host);
    expect(started.status).toBe('waiting');
    expectScript(host, 10);
    const { state } = started;
    const second = await continueWith(flow, state, { text: 'hola' }, host.host);
    expect(second.ok && second.status).toBe('ended');
    expect(host.requests).toHaveLength(11);
  });

  it('un primer intento después de agotar el presupuesto con reintentos también falla', async () => {
    const flow = flowOf([httpNode('a', {}, { retries: 5, next: 'b', onError: 'b' }), httpNode('b', {}, { retries: 5, next: 'c', onError: 'c' }), httpNode('c', {}, { next: 'fin', onError: 'fin' }), end('fin')]);
    const host = always(respond(503));
    const result = await runOk(flow, host.host);
    expectFailure(result, 'http_limit_exceeded', 'c');
    expect(httpEvents(result).map((e) => (e as { attempts: number }).attempts)).toEqual([6, 4]);
  });
});

describe('Límite de llamadas con llm', () => {
  it('Un llm consume del mismo presupuesto', async () => {
    const nodes = [
      llmNode({ slots: undefined, next: 'h0' }),
      ...Array.from({ length: 10 }, (_, i) => httpNode(`h${i}`, {}, { retries: 0, next: i + 1 < 10 ? `h${i + 1}` : 'fin', onError: i + 1 < 10 ? `h${i + 1}` : 'fin' })),
      end('fin', { outcome: 'ok' }),
      end('ko', { outcome: 'ko' }),
    ];
    const http = always(respond(200));
    const { host } = withHosts(http.host, alwaysLlm(turn('Hecho', {}, true)).host);
    const result = await runOk(llmFlow({}, { nodes }), host);
    expect(httpEvents(result)).toHaveLength(9);
    expectFailure(result, 'http_limit_exceeded', 'h9');
    expect(http.requests).toHaveLength(9);
  });
});
