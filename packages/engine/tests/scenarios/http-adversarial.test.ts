import { describe, expect, it, vi } from 'vitest';
import { startSession, type EngineHost } from '../../src/index.js';
import { personalVariables } from '../../src/http/request.js';
import { condition, end, flowOf, httpNode, input, rule, setNode, variable, type Obj } from '../helpers/flows.js';
import { always, expectScript, respond, scriptedHost, type Step } from '../helpers/http-host.js';
import { continueWith, expectFailure, httpEvents, httpFlow, outcomeOf, runOk, withValue } from '../helpers/http-flow.js';

const MIB = 1048576;
const everything = (...parts: unknown[]): string => JSON.stringify(parts);

describe('Reintentos: matriz método × resultado × retries contra un oráculo independiente', () => {
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
  const IDEMPOTENT = new Set(['GET', 'PUT', 'DELETE']);

  type Case = { label: string; step: Step; success: boolean; status: number | null; error: string | null; retryable: (idempotent: boolean) => boolean };
  const response = (status: number, body = ''): Case => {
    const success = status >= 200 && status <= 299;
    return {
      label: `status ${status}`,
      step: respond(status, body),
      success,
      status,
      error: success ? null : 'http_status',
      retryable: (idempotent) => !success && ([408, 429].includes(status) || (idempotent && [500, 502, 503, 504].includes(status))),
    };
  };
  const CASES: Case[] = [
    ...[200, 201, 204, 299, 300, 301, 302, 304, 400, 401, 403, 404, 405, 408, 409, 410, 418, 422, 425, 429, 451, 500, 501, 502, 503, 504, 505, 507, 511, 599].map((s) => response(s)),
    { label: 'timeout', step: { kind: 'timeout' }, success: false, status: null, error: 'timeout', retryable: (i) => i },
    { label: 'network_error enviada', step: { kind: 'network_error', requestSent: true }, success: false, status: null, error: 'network_error', retryable: (i) => i },
    { label: 'network_error sin enviar', step: { kind: 'network_error', requestSent: false }, success: false, status: null, error: 'network_error', retryable: () => true },
    { label: 'network_error sin requestSent', step: { kind: 'network_error' }, success: false, status: null, error: 'network_error', retryable: (i) => i },
    { label: 'blocked', step: { kind: 'blocked' }, success: false, status: null, error: 'blocked', retryable: () => false },
    { label: 'response_too_large', step: { kind: 'response_too_large' }, success: false, status: null, error: 'response_too_large', retryable: () => false },
    { label: '503 con cuerpo de 1 MiB + 1', step: respond(503, 'x'.repeat(MIB + 1)), success: false, status: 503, error: 'response_too_large', retryable: () => false },
    { label: '429 con cuerpo de 1 MiB + 1', step: respond(429, 'x'.repeat(MIB + 1)), success: false, status: 429, error: 'response_too_large', retryable: () => false },
    { label: '200 con cuerpo de 1 MiB + 1', step: respond(200, 'x'.repeat(MIB + 1)), success: false, status: 200, error: 'response_too_large', retryable: () => false },
    { label: '200 con cuerpo de 1 MiB', step: respond(200, 'x'.repeat(MIB)), success: true, status: 200, error: null, retryable: () => false },
  ];

  it.each(METHODS.map((m) => [m] as const))('%s', async (method) => {
    const idempotent = IDEMPOTENT.has(method);
    for (const c of CASES) {
      for (const retries of [0, 1, 2, 3, 4, 5]) {
        const host = always(c.step);
        const body = method === 'GET' ? {} : { body: { a: 1 } };
        const result = await runOk(httpFlow({ method, ...body }, { retries }), host.host);
        const expectedCalls = c.retryable(idempotent) ? 1 + retries : 1;
        const label = `${method} ${c.label} retries ${retries}`;
        expect(host.requests.map((r) => r.attempt), label).toEqual(Array.from({ length: expectedCalls }, (_, i) => i + 1));
        expect(httpEvents(result), label).toEqual([{ type: 'http', nodeId: 'h', attempts: expectedCalls, status: c.status, error: c.error }]);
        expect(outcomeOf(result), label).toBe(c.success ? 'ok' : 'ko');
      }
    }
  });

  it('el retries por defecto es 1 en cualquier método reintentable', async () => {
    for (const method of METHODS) {
      const host = always(respond(429));
      await runOk(httpFlow({ method }), host.host);
      expect(host.requests, method).toHaveLength(2);
    }
  });

  it('un error no reintentable tras un reintento corta en ese punto (503, 400)', async () => {
    const host = scriptedHost([respond(503), respond(400), respond(200)]);
    const result = await runOk(httpFlow({}, { retries: 5 }), host.host);
    expectScript(host, 2);
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 2, status: 400, error: 'http_status' }]);
  });

  it('el estado del último intento manda: 503, timeout, 200 es éxito con 3 intentos', async () => {
    const host = scriptedHost([respond(503), { kind: 'timeout' }, respond(200)]);
    const result = await runOk(httpFlow({}, { retries: 5 }), host.host);
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 3, status: 200, error: null }]);
  });

  it('un 2xx tras un reintento no deja el status ni el error del intento anterior', async () => {
    const host = scriptedHost([{ kind: 'timeout' }, respond(201, '{"id":"T-7"}')]);
    const flow = httpFlow({}, { retries: 1, responseMap: [{ variable: 'v', pointer: '/id' }] });
    const result = await runOk(flow, host.host);
    expect(result.state.variables.v).toBe('T-7');
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 2, status: 201, error: null }]);
  });
});

describe('Presupuesto de 10 llamadas compartido entre nodos y ciclos', () => {
  it('un ciclo con reintentos recorta el último reintento y después falla el primer intento', async () => {
    const flow = flowOf(
      [httpNode('h', {}, { retries: 2, next: 'c', onError: 'c' }), condition('c', [[rule('v', 'eq', 'nunca'), 'fin']], 'h'), end('fin')],
      { variables: [variable('v')] },
    );
    const host = always(respond(503));
    const result = await runOk(flow, host.host);
    expect(httpEvents(result).map((e) => (e as { attempts: number }).attempts)).toEqual([3, 3, 3, 1]);
    expectScript(host, 10);
    expect(result.events.at(-1)).toMatchObject({ type: 'error', code: 'http_limit_exceeded', nodeId: 'h' });
    expect(result.state.error).toEqual({ code: 'http_limit_exceeded', nodeId: 'h' });
  });

  it('los nodos con retries 0 gastan una llamada cada uno y la undécima falla', async () => {
    const nodes = Array.from({ length: 11 }, (_, i) => httpNode(`h${i}`, {}, { retries: 0, next: i < 10 ? `h${i + 1}` : 'fin', onError: i < 10 ? `h${i + 1}` : 'fin' }));
    const host = always(respond(200));
    const result = await runOk(flowOf([...nodes, end('fin')]), host.host);
    expect(httpEvents(result)).toHaveLength(10);
    expectFailure(result, 'http_limit_exceeded', 'h10');
    expectScript(host, 10);
  });

  it('un error que no se reintenta no cuesta más que una llamada: 10 nodos con 404 y retries 5 caben', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => httpNode(`h${i}`, {}, { retries: 5, next: i < 9 ? `h${i + 1}` : 'fin', onError: i < 9 ? `h${i + 1}` : 'fin' }));
    const host = always(respond(404));
    const result = await runOk(flowOf([...nodes, end('fin', { outcome: 'listo' })]), host.host);
    expect(result.status).toBe('ended');
    expectScript(host, 10);
  });

  it('una petición que no se puede construir no gasta presupuesto', async () => {
    const nodes = [
      ...Array.from({ length: 5 }, (_, i) => httpNode(`m${i}`, { url: 'http://localhost/' }, { next: `m${i + 1}`, onError: `m${i + 1}` })),
      ...Array.from({ length: 10 }, (_, i) => httpNode(`h${i}`, {}, { retries: 0, next: i < 9 ? `h${i + 1}` : 'fin', onError: i < 9 ? `h${i + 1}` : 'fin' })),
    ];
    nodes[4]!.next = 'h0';
    nodes[4]!.onError = 'h0';
    const host = always(respond(200));
    const result = await runOk(flowOf([...nodes, end('fin', { outcome: 'listo' })]), host.host);
    expect(result.status).toBe('ended');
    expectScript(host, 10);
    expect(httpEvents(result).slice(0, 5).every((e) => (e as { attempts: number }).attempts === 0)).toBe(true);
  });

  it('el presupuesto se reinicia en cada operación aunque la anterior lo agotara', async () => {
    const flow = flowOf(
      [
        ...Array.from({ length: 10 }, (_, i) => httpNode(`h${i}`, {}, { retries: 0, next: i < 9 ? `h${i + 1}` : 'p', onError: i < 9 ? `h${i + 1}` : 'p' })),
        input('p', 'v', 'text', 'x0'),
        ...Array.from({ length: 10 }, (_, i) => httpNode(`x${i}`, {}, { retries: 0, next: i < 9 ? `x${i + 1}` : 'fin', onError: i < 9 ? `x${i + 1}` : 'fin' })),
        end('fin', { outcome: 'listo' }),
      ],
      { variables: [variable('v')] },
    );
    const host = always(respond(200));
    const started = await runOk(flow, host.host);
    expect(started.status).toBe('waiting');
    const second = await continueWith(flow, started.state, { text: 'hola' }, host.host);
    expect(second.ok && second.status).toBe('ended');
    expect(host.requests).toHaveLength(20);
  });
});

describe('Secretos y datos personales frente a hosts hostiles', () => {
  const MARKER = 'ZQXJ-SECRETO-QA3-7c1d';
  const flowWithSecret = () => httpFlow({ headers: { Authorization: { secret: 'CRM_TOKEN' } } }, { retries: 2 });

  const poisoned = (): Step => {
    const result = { kind: 'response', status: 200, body: '{}' };
    return new Proxy(result, {
      get(target, property) {
        if (property === 'kind') throw new Error(`proxy con ${MARKER}`);
        return Reflect.get(target, property);
      },
    });
  };

  const VARIANTS: [string, Step][] = [
    ['Proxy cuyo get lanza con el marcador', poisoned()],
    ['then que lanza al esperar', { then() { throw new Error(`then con ${MARKER}`); } }],
    ['getter then que lanza', Object.defineProperty({}, 'then', { get() { throw new Error(MARKER); } })],
    ['then que rechaza con el marcador', { then(_resolve: unknown, reject: (e: unknown) => void) { reject(new Error(MARKER)); } }],
    ['throw de un string', () => { throw MARKER; }],
    ['throw de un objeto con toString', () => { throw { toString: () => MARKER, secret: MARKER }; }],
    ['rechazo con un símbolo', () => Promise.reject(Symbol(MARKER))],
    ['rechazo con un objeto circular', () => { const e: Record<string, unknown> = { marker: MARKER }; e.self = e; return Promise.reject(e); }],
    ['kind inválido con el marcador', { kind: MARKER, secret: MARKER }],
    ['missing_secret con propiedades extra', { kind: 'missing_secret', secret: MARKER, message: MARKER }],
    ['status como string con el marcador', { kind: 'response', status: MARKER, body: '' }],
    ['body como objeto con el marcador', { kind: 'response', status: 200, body: { eco: MARKER } }],
    ['array con el marcador', [MARKER]],
    ['función con el marcador', Object.assign(() => MARKER, { kind: 'response' })],
    ['string con el marcador', MARKER],
    ['undefined', undefined],
  ];

  it.each(VARIANTS)('%s: sin marcador en eventos, errores ni estado, y la promesa no se rechaza', async (_label, step) => {
    const host = always(step);
    const result = await runOk(flowWithSecret(), host.host);
    expect(everything(result)).not.toContain(MARKER);
    // Todo lo que está fuera de contrato falla la sesión (sin reintentar ni seguir por onError); solo missing_secret es un fallo distinto.
    expectFailure(result, _label.startsWith('missing_secret') ? 'missing_secret' : 'http_host_error');
    expect(host.requests).toHaveLength(1);
    expect(httpEvents(result)).toEqual([]);
  });

  it('el host recibe solo el nombre del secreto en la petición, nunca un valor', async () => {
    const host = always(respond(204));
    await runOk(flowWithSecret(), host.host);
    expect(host.requests[0]!.headers).toEqual([{ name: 'Authorization', secret: 'CRM_TOKEN' }]);
  });

  it('un host que cambia la petición con el marcador no lo filtra al estado ni a los reintentos', async () => {
    const host = scriptedHost([
      (request: { headers: { name: string; secret?: string; value?: string }[]; url: string }) => {
        request.headers[0]!.secret = MARKER;
        request.headers.push({ name: 'X-Eco', value: MARKER });
        request.url = `https://evil.example.com/${MARKER}`;
        return respond(503);
      },
      respond(200),
    ]);
    const result = await runOk(flowWithSecret(), host.host);
    expect(host.requests[1]!.headers).toEqual([{ name: 'Authorization', secret: 'CRM_TOKEN' }]);
    expect(host.requests[1]!.url).toBe('https://api.example.com/');
    expect(everything(result)).not.toContain(MARKER);
  });

  it('el valor de una variable personal solo aparece en la petición del host, no en eventos ni estado de un fallo', async () => {
    const PII = 'pii-qa3@example.com';
    const flow = httpFlow({ method: 'POST', url: 'https://api.example.com/?e={{email}}', headers: { 'X-E': '{{email}}' }, body: { e: '{{email}}' } }, { retries: 1 }, { variables: [withValue('email', PII, { pii: true })] });
    for (const step of [respond(500, PII), respond(200, PII), { kind: 'timeout' }, { kind: 'network_error', requestSent: false }, { kind: 'blocked' }]) {
      const host = always(step);
      const result = await runOk(flow, host.host);
      expect(host.requests.every((r) => r.containsPii)).toBe(true);
      expect(JSON.stringify(result.events)).not.toContain(PII);
      expect(JSON.stringify(result.events)).not.toContain(encodeURIComponent(PII));
      expect(JSON.stringify(result.state.error)).not.toContain('pii-qa3');
    }
  });

  it('console no se toca con ningún host hostil', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    for (const [, step] of VARIANTS) await runOk(flowWithSecret(), always(step).host);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((spy) => spy.mockRestore());
  });

  it('un host cuya propiedad http es un Proxy de función se llama una vez y con this igual al host', async () => {
    let receivers = 0;
    const target = async () => respond(200);
    const host: EngineHost = { http: new Proxy(target, { apply(fn, thisArg, args) { if (thisArg === host) receivers++; return Reflect.apply(fn, thisArg, args); } }) as EngineHost['http'] };
    const result = await runOk(httpFlow({}, { retries: 0 }), host);
    expect(outcomeOf(result)).toBe('ok');
    expect(receivers).toBe(1);
  });
});

describe('responseMap con respuestas grandes y claves especiales', () => {
  const map = (pointer: string, variableName = 'v') => ({ responseMap: [{ variable: variableName, pointer }] });
  const run = async (body: string, extra: Obj, variables: Obj[] = [variable('v')]) => runOk(httpFlow({}, extra, { variables }), always(respond(200, body)).host);

  it('un cuerpo de exactamente 1 MiB con el campo mapeado al principio se asigna rápido', async () => {
    const head = '{"v":"ok","pad":"';
    const body = `${head}${'x'.repeat(MIB - head.length - 2)}"}`;
    expect(body).toHaveLength(MIB);
    const t0 = performance.now();
    const result = await run(body, map('/v'));
    expect(result.state.variables.v).toBe('ok');
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('un cuerpo de 1 MiB + 1 es response_too_large aunque sea JSON válido y haya responseMap (no se parsea)', async () => {
    const head = '{"v":"ok","pad":"';
    const body = `${head}${'x'.repeat(MIB + 1 - head.length - 2)}"}`;
    const result = await run(body, map('/v'));
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 1, status: 200, error: 'response_too_large' }]);
    expect(result.state.variables.v).toBeUndefined();
  });

  it('el documento entero ("") sobre 1 MiB es invalid_response (más de 16384 unidades) y nada se asigna', async () => {
    const body = `{"p":"${'x'.repeat(MIB - 10)}"}`;
    const result = await run(body, { responseMap: [{ variable: 'v', pointer: '' }, { variable: 'w', pointer: '/p' }] }, [variable('v'), variable('w')]);
    expect(httpEvents(result)[0]).toMatchObject({ error: 'invalid_response', status: 200 });
    expect(result.state.variables).toEqual({});
  });

  it('claves vacías, numéricas y con barras; índices de array y propiedades que parecen índices', async () => {
    const body = JSON.stringify({ '': 'vacia', '0': 'cero', 'a/b': 1, 'm~n': 2, '~1': 3, lista: ['x', 'y'], 'lista.length': 9 });
    const vars = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'].map((n) => variable(n, { type: 'json' }));
    const result = await run(
      body,
      {
        responseMap: [
          { variable: 'k0', pointer: '/' },
          { variable: 'k1', pointer: '/0' },
          { variable: 'k2', pointer: '/a~1b' },
          { variable: 'k3', pointer: '/m~0n' },
          { variable: 'k4', pointer: '/~01' },
          { variable: 'k5', pointer: '/lista/1' },
          { variable: 'k6', pointer: '/lista/length' },
          { variable: 'k7', pointer: '/lista/-' },
          { variable: 'k8', pointer: '/lista.length' },
        ],
      },
      vars,
    );
    expect(result.state.variables).toEqual({ k0: 'vacia', k1: 'cero', k2: 1, k3: 2, k4: 3, k5: 'y', k8: 9 });
  });

  it('el documento raíz puede ser un array o un escalar y "" lo asigna entero', async () => {
    const asArray = await run('[1,{"a":null},"z"]', map(''), [variable('v', { type: 'json' })]);
    expect(asArray.state.variables.v).toEqual([1, { a: null }, 'z']);
    const asNumber = await run(' 42 ', map(''), [variable('v', { type: 'number' })]);
    expect(asNumber.state.variables.v).toBe(42);
    const asNull = await run('null', map(''), [variable('v', { default: 'previo' })]);
    expect(asNull.state.variables.v).toBeUndefined();
    expect(outcomeOf(asNull)).toBe('ok');
  });

  it('-0, exponentes y números largos se asignan como numbers finitos; 1e999 es invalid_response', async () => {
    const ok = await run('{"v":-0}', map('/v'));
    expect(Object.is(ok.state.variables.v, 0)).toBe(true);
    expect((await run('{"v":1E5}', map('/v'))).state.variables.v).toBe(100000);
    expect((await run('{"v":0.1e-6}', map('/v'))).state.variables.v).toBe(1e-7);
    expect(httpEvents(await run('{"v":1e999}', map('/v')))[0]).toMatchObject({ error: 'invalid_response' });
    expect(httpEvents(await run('{"v":-1e999}', map('/v')))[0]).toMatchObject({ error: 'invalid_response' });
  });

  it('un valor mapeado con claves __proto__ y constructor sobrevive a JSON y no contamina nada', async () => {
    const result = await run('{"p":{"__proto__":{"polluted":1},"constructor":2}}', map('/p'), [variable('v', { type: 'json' })]);
    expect(outcomeOf(result)).toBe('ok');
    const stored = result.state.variables.v as Record<string, unknown>;
    expect(Object.hasOwn(stored, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
  });

  it('BOM, espacios y saltos de línea alrededor del JSON: el BOM no es JSON, el resto sí', async () => {
    expect(outcomeOf(await run('\n {"v":"ok"} \t', map('/v')))).toBe('ok');
    expect(httpEvents(await run('\ufeff{"v":"ok"}', map('/v')))[0]).toMatchObject({ error: 'invalid_response' });
    expect(httpEvents(await run('{"v":"ok"} {"v":"ko"}', map('/v')))[0]).toMatchObject({ error: 'invalid_response' });
    expect(httpEvents(await run("{'v':'ok'}", map('/v')))[0]).toMatchObject({ error: 'invalid_response' });
    expect(httpEvents(await run('{"v":"ok",}', map('/v')))[0]).toMatchObject({ error: 'invalid_response' });
  });

  it('claves duplicadas: gana la última, como JSON.parse', async () => {
    expect((await run('{"v":"a","v":"b"}', map('/v'))).state.variables.v).toBe('b');
  });

  it('un valor mapeado de profundidad 100 sobrevive a la pausa de un input y al viaje por JSON', async () => {
    let deep: unknown = 'hoja';
    for (let i = 0; i < 99; i++) deep = [deep];
    const flow = flowOf(
      [httpNode('h', {}, { next: 'p', onError: 'fin', responseMap: [{ variable: 'v', pointer: '/d' }] }), input('p', 'w', 'text', 'fin'), end('fin', { outcome: 'listo' })],
      { variables: [variable('v', { type: 'json' }), variable('w')] },
    );
    const started = await runOk(flow, always(respond(200, JSON.stringify({ d: deep }))).host);
    expect(started.status).toBe('waiting');
    const state = JSON.parse(JSON.stringify(started.state));
    const done = await continueWith(flow, state, { text: 'x' });
    expect(done.ok && done.status).toBe('ended');
    expect(done.ok && done.state.variables.v).toEqual(deep);
  });

  it('un puntero a una variable de contacto actualiza contact y no variables', async () => {
    const result = await run('{"e":"nuevo@example.com"}', map('/e', 'email'), [variable('email', { scope: 'contact' }), variable('v')]);
    expect(result.state.contact).toEqual({ email: 'nuevo@example.com' });
    expect(result.state.variables).toEqual({});
  });
});

describe('Body, cabeceras y configuración en el nodo', () => {
  const run = async (request: Obj, variables: Obj[] = [variable('v')], host = always(respond(200))) => {
    const result = await runOk(httpFlow(request, {}, { variables }), host.host);
    return { result, host };
  };

  it('el body del flujo se ejecuta en su forma JSON: NaN, Infinity, undefined, funciones y -0', async () => {
    const { host } = await run({ method: 'POST', body: { a: Number.NaN, b: Number.POSITIVE_INFINITY, c: -0, d: undefined, e: () => 1, f: [undefined, 1n === 1n ? 1 : 0], g: new Date(0) } });
    expect(host.requests[0]!.body).toBe('{"a":null,"b":null,"c":0,"f":[null,1],"g":"1970-01-01T00:00:00.000Z"}');
  });

  it('claves de índice primero y en orden numérico, también en objetos anidados y con __proto__ o constructor', async () => {
    const flow = JSON.parse(
      '{"specVersion":"0.1","id":"orden","name":"Orden","variables":[{"name":"n","type":"string","default":"Ana"}],"start":"h","nodes":[' +
        '{"id":"h","type":"http","request":{"method":"POST","url":"https://api.example.com/","headers":{"b":"1","10":"2","2":"3","a":"4"},' +
        '"body":{"z":1,"10":{"__proto__":"{{n}}","3":0,"constructor":1},"2":true,"a":["{{n}}",{"y":1,"1":2}]}},"next":"fin","onError":"fin"},' +
        '{"id":"fin","type":"end"}]}',
    );
    const host = always(respond(200));
    await runOk(flow, host.host);
    expect(host.requests[0]!.body).toBe('{"2":true,"10":{"3":0,"__proto__":"Ana","constructor":1},"z":1,"a":["Ana",{"1":2,"y":1}]}');
    expect(host.requests[0]!.headers.map((h) => h.name)).toEqual(['2', '10', 'b', 'a', 'Content-Type']);
  });

  it('32 cabeceras con secretos mezclados se envían y el Content-Type por defecto no cuenta; 33 fallan', async () => {
    const headers = (count: number): Obj => Object.fromEntries(Array.from({ length: count }, (_, i) => [`X-H${i + 1}`, i % 2 ? { secret: `TOKEN_${i}` } : `v${i}`]));
    const { host } = await run({ method: 'POST', body: { a: 1 }, headers: headers(32) });
    expect(host.requests[0]!.headers).toHaveLength(33);
    const flow = httpFlow({ method: 'POST', body: { a: 1 }, headers: headers(33) });
    const failing = always(respond(200));
    expectFailure(await runOk(flow, failing.host), 'invalid_http_config');
    expectScript(failing, 0);
  });

  it.each([
    ['Content-Type repetido con otra capitalización', { 'Content-Type': 'a', 'CONTENT-TYPE': 'b' }],
    ['Content-Type como secreto y como valor', { 'content-type': { secret: 'CT' }, 'Content-Type': 'x' }],
    ['Host con secreto', { Host: { secret: 'HOST_TOKEN' } }],
    ['Proxy- con secreto', { 'proxy-authorization': { secret: 'P' } }],
    ['nombre con punto y coma', { 'X;Y': 'x' }],
    ['nombre con barra', { 'X/Y': 'x' }],
    ['nombre con NBSP', { 'X\u00a0Y': 'x' }],
    ['nombre con sustituto', { 'X\ud800': 'x' }],
  ])('%s → invalid_http_config sin llamar al host', async (_label, headers) => {
    const host = always(respond(200));
    expectFailure(await runOk(httpFlow({ headers }), host.host), 'invalid_http_config');
    expectScript(host, 0);
  });

  it('GET con body false, 0, "" o {} falla; con null o sin body llama al host; DELETE con body true llama', async () => {
    for (const body of [false, 0, '', {}, [], 'x']) {
      const host = always(respond(200));
      expectFailure(await runOk(httpFlow({ method: 'GET', body }), host.host), 'invalid_http_config');
      expectScript(host, 0);
    }
    for (const request of [{ method: 'GET', body: null }, { method: 'GET' }] as Obj[]) {
      const host = always(respond(200));
      expect(outcomeOf(await runOk(httpFlow(request), host.host))).toBe('ok');
      expect(host.requests[0]!.body).toBeNull();
    }
    const del = always(respond(200));
    await runOk(httpFlow({ method: 'DELETE', body: true }), del.host);
    expect(del.requests[0]!.body).toBe('true');
  });

  it('body null en POST no añade Content-Type; body "" sí (es un texto JSON) y body 0 también', async () => {
    const post = async (body: unknown) => (await run({ method: 'POST', body })).host.requests[0]!;
    expect((await post(null)).headers).toEqual([]);
    expect(await post('')).toMatchObject({ body: '""', headers: [{ name: 'Content-Type', value: 'application/json' }] });
    expect(await post(0)).toMatchObject({ body: '0', headers: [{ name: 'Content-Type', value: 'application/json' }] });
  });

  it('los valores de cabecera con tabulador y espacio se admiten; con DEL, NEL o NBSP no', async () => {
    const attempt = async (value: string) => outcomeOf((await run({ headers: { 'X-A': value } })).result);
    expect(await attempt('a\tb c')).toBe('ok');
    for (const bad of ['a\u007fb', 'a\u0085b', 'a\u00a0b', 'a\rb', 'a\nb', 'a\u0000b', 'a\u2028b', 'café', '\ud800']) expect(await attempt(bad), JSON.stringify(bad)).toBe('ko');
    const { result } = await run({ headers: { 'X-A': '{{v}}' } }, [withValue('v', 'x\r\nX-Admin: 1')]);
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 0, status: null, error: 'invalid_header_value' }]);
  });

  it('un body que supera 65536 con un valor de cabecera inválido: gana la cabecera; con URL inválida, la URL', async () => {
    const big = withValue('a', 'x'.repeat(16000));
    const bodyBig = ['{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}'];
    const header = await run({ method: 'POST', body: bodyBig, headers: { 'X-A': 'é' } }, [big]);
    expect(httpEvents(header.result)[0]).toMatchObject({ error: 'invalid_header_value' });
    const url = await run({ method: 'POST', body: bodyBig, headers: { 'X-A': 'é' }, url: 'http://localhost/' }, [big]);
    expect(httpEvents(url.result)[0]).toMatchObject({ error: 'invalid_url' });
    const body = await run({ method: 'POST', body: bodyBig }, [big]);
    expect(httpEvents(body.result)[0]).toMatchObject({ error: 'body_too_large' });
  });

  it('el value_too_large de una cabecera gana a todo, incluida una URL inválida y un puntero malo no (configuración antes)', async () => {
    const huge = withValue('a', 'x'.repeat(16385));
    const host = always(respond(200));
    const sized = await runOk(httpFlow({ url: 'ftp://x/', headers: { 'X-A': '{{a}}' } }, {}, { variables: [huge, variable('v')] }), host.host);
    expectFailure(sized, 'value_too_large');
    const configured = await runOk(httpFlow({ headers: { 'X-A': '{{a}}', 'X B': 'x' } }, {}, { variables: [huge, variable('v')] }), host.host);
    expectFailure(configured, 'invalid_http_config');
    expectScript(host, 0);
  });
});

describe('containsPii: cierre por set con cadenas y ciclos', () => {
  const flowWith = (assignments: [string, string | number | boolean | null][], pii = ['email']) =>
    flowOf(
      [
        ...assignments.map(([name, value], i) => setNode(`s${i}`, [[name, value]], i + 1 < assignments.length ? `s${i + 1}` : 'fin')),
        end('fin'),
      ],
      { variables: ['email', 'a', 'b', 'c', 'd', 'x'].map((name) => variable(name, pii.includes(name) ? { pii: true } : {})) },
    ) as never;

  it('un ciclo de set a ↔ b sin pii no la inventa, y con una entrada pii las marca a todas', () => {
    expect([...personalVariables(flowWith([['a', '{{b}}'], ['b', '{{a}}']]))].sort()).toEqual(['email']);
    expect([...personalVariables(flowWith([['a', '{{b}}'], ['b', '{{a}}{{email}}'], ['c', '{{a}}']]))].sort()).toEqual(['a', 'b', 'c', 'email']);
  });

  it('autoasignación, cadena larga en orden inverso y asignaciones que no son plantillas', () => {
    expect([...personalVariables(flowWith([['a', '{{a}}']]))]).toEqual(['email']);
    const chain = flowWith([['d', '{{c}}'], ['c', '{{b}}'], ['b', '{{a}}'], ['a', 'x {{ email }} y']]);
    expect([...personalVariables(chain)].sort()).toEqual(['a', 'b', 'c', 'd', 'email']);
    const literals = flowWith([['a', 7], ['b', true], ['c', null], ['d', 'sin marcadores {email}']]);
    expect([...personalVariables(literals)]).toEqual(['email']);
  });

  it('una variable derivada marca containsPii en la petición aunque el set esté en una rama que no se ejecuta', async () => {
    const flow = flowOf(
      [
        condition('c', [[rule('x', 'eq', 'nunca'), 's']], 'h'),
        setNode('s', [['copia', 'Hola {{email}}']], 'h'),
        httpNode('h', { method: 'POST', body: { t: '{{copia}}' } }, { next: 'fin', onError: 'fin' }),
        end('fin'),
      ],
      { variables: [variable('email', { pii: true }), variable('copia'), variable('x')] },
    );
    const host = always(respond(200));
    await runOk(flow, host.host);
    expect(host.requests[0]!.containsPii).toBe(true);
  });

  it('las claves del body y los nombres de cabecera no cuentan; el valor de una cabecera sí', async () => {
    const vars = [variable('email', { pii: true }), variable('v')];
    const keyOnly = always(respond(200));
    await runOk(httpFlow({ method: 'POST', body: { '{{email}}': 1 }, headers: { 'X-Email': 'fijo' } }, {}, { variables: vars }), keyOnly.host);
    expect(keyOnly.requests[0]!.containsPii).toBe(false);
    const value = always(respond(200));
    await runOk(httpFlow({ method: 'POST', body: [{ a: [['{{ email }}']] }] }, {}, { variables: vars }), value.host);
    expect(value.requests[0]!.containsPii).toBe(true);
  });
});

describe('Forma del host recibido', () => {
  const hosts: [string, unknown, string][] = [
    ['undefined', undefined, 'unsupported_node'],
    ['null', null, 'unsupported_node'],
    ['false', false, 'unsupported_node'],
    ['0', 0, 'unsupported_node'],
    ['string vacío', '', 'unsupported_node'],
    ['string', 'x', 'unsupported_node'],
    ['NaN', Number.NaN, 'unsupported_node'],
    ['símbolo', Symbol('s'), 'unsupported_node'],
    ['bigint', 1n, 'unsupported_node'],
    ['array', [], 'unsupported_node'],
    ['función', () => 1, 'unsupported_node'],
    ['objeto sin prototipo', Object.create(null), 'unsupported_node'],
    ['http undefined', { http: undefined }, 'unsupported_node'],
    ['http null', { http: null }, 'unsupported_node'],
    ['http objeto', { http: { call: () => 1 } }, 'unsupported_node'],
    ['Proxy cuyo get lanza', new Proxy({}, { get() { throw new Error('boom'); } }), 'http_host_error'],
    ['http es una clase (no se puede llamar sin new)', { http: class {} }, 'http_host_error'],
  ];

  it.each(hosts)('%s', async (_label, host, code) => {
    const result = await startSession({ flow: httpFlow() }, host as EngineHost);
    expect(result.ok).toBe(true);
    if (result.ok) expectFailure(result, code);
  });

  it('un host congelado y uno sin prototipo con http funcionan', async () => {
    const http = async () => respond(200);
    for (const host of [Object.freeze({ http }), Object.assign(Object.create(null), { http })]) {
      expect(outcomeOf(await runOk(httpFlow(), host as EngineHost))).toBe('ok');
    }
  });
});

describe('Regresión de profundidad: valores anidados al límite en las plantillas de un http', () => {
  const chain = (levels: number): unknown => {
    let value: unknown = 1;
    for (let i = 0; i < levels; i++) value = [value];
    return value;
  };
  const flowWith = (request: Obj) => httpFlow(request, {}, { variables: [variable('c', { type: 'json', scope: 'contact' })] });

  it('un contacto de 999 niveles se inserta en body, cabecera y URL sin lanzar: el body, la cabecera y la URL (codificada, 6022 unidades) lo llevan', async () => {
    const contact = { c: chain(999) };
    const asText = JSON.stringify(chain(999));
    const body = always(respond(200));
    await runOk(flowWith({ method: 'POST', body: { c: '{{c}}' } }), body.host, contact);
    expect(body.requests[0]!.body).toBe(JSON.stringify({ c: asText }));
    const header = always(respond(200));
    await runOk(flowWith({ headers: { 'X-C': '{{c}}' } }), header.host, contact);
    expect(header.requests[0]!.headers).toEqual([{ name: 'X-C', value: asText }]);
    const url = always(respond(200));
    const result = await runOk(flowWith({ url: 'https://api.example.com/?c={{c}}' }), url.host, contact);
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 1, status: 200, error: null }]);
    expect(url.requests[0]!.url).toBe(`https://api.example.com/?c=${'%5B'.repeat(999)}1${'%5D'.repeat(999)}`);
    expect(url.requests[0]!.url).toHaveLength(6022);
    // Dos veces el mismo valor ya no caben: 27 + 2 × 5995 > 8192.
    const twice = always(respond(200));
    const over = await runOk(flowWith({ url: 'https://api.example.com/?a={{c}}&b={{c}}' }), twice.host, contact);
    expect(httpEvents(over)).toEqual([{ type: 'http', nodeId: 'h', attempts: 0, status: null, error: 'invalid_url' }]);
    expectScript(twice, 0);
  });

  it('el estado con ese contacto sobrevive a la pausa de un input después del http y al viaje por JSON', async () => {
    const flow = flowOf(
      [httpNode('h', { method: 'POST', body: { c: '{{c}}' } }, { next: 'p', onError: 'fin' }), input('p', 'w', 'text', 'fin'), end('fin', { outcome: 'listo' })],
      { variables: [variable('c', { type: 'json', scope: 'contact' }), variable('w')] },
    );
    const host = always(respond(200));
    const started = await runOk(flow, host.host, { c: chain(999) });
    expect(started.status).toBe('waiting');
    const done = await continueWith(flow, JSON.parse(JSON.stringify(started.state)), { text: 'x' }, host.host);
    expect(done.ok && done.status).toBe('ended');
  });
});
