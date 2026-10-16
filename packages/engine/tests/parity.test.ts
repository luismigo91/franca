import { schema } from '@franca/spec';
import type { AdvanceResult, SessionResult } from '../src/index.js';
import { IDEMPOTENT } from '../src/http/retry.js';
import { PARSERS } from '../src/input/parsers/index.js';
import { DEFAULT_HTTP_RETRIES, DEFAULT_HTTP_TIMEOUT_MS } from '../src/constants.js';
import { HTTP_ERROR_REASONS } from '../src/index.js';
import { always, respond, scriptedHost, type Step } from './helpers/http-host.js';
import { httpFlow } from './helpers/http-flow.js';
import { describe, expect, it } from 'vitest';
import { INVALID_ANSWER_REASONS, REJECTION_CODES, SESSION_ERROR_CODES, continueSession, startSession } from '../src/index.js';
import { EXECUTORS } from '../src/nodes/index.js';
import { OPERATORS } from '../src/predicates.js';
import { allFlows } from './helpers/files.js';
import { deepFreeze, end, flowOf, http, httpNode, input, jump, message, variable } from './helpers/flows.js';

type Defs = Record<string, { properties?: { type?: { const?: string } } }>;
const defs = schema.$defs as unknown as Defs;

describe('paridad con flow.schema.json', () => {
  it('los tipos de nodo del esquema son las claves de EXECUTORS', () => {
    const refs = (schema.$defs.node.oneOf as { $ref: string }[]).map((entry) => entry.$ref.split('/').pop()!);
    const types = refs.map((ref) => defs[ref]!.properties!.type!.const!);
    expect(types.length).toBe(8);
    expect(Object.keys(EXECUTORS).sort()).toEqual([...types].sort());
  });

  it('los operadores del esquema son las claves de OPERATORS', () => {
    const ops = schema.$defs.rule.properties.op.enum;
    expect(Object.keys(OPERATORS).sort()).toEqual([...ops].sort());
  });
});

describe('códigos emitidos', () => {
  it('todo código de error de sesión emitido está en SESSION_ERROR_CODES', async () => {
    const emitted = new Set<string>();
    const flows: unknown[] = [
      flowOf([http('h', 'fin', 'fin'), end('fin')]),
      flowOf([message('m', '{{a}}{{a}}', 'fin'), end('fin')], { variables: [variable('a', { default: 'x'.repeat(10000) })] }),
      flowOf([{ id: 'c', type: 'condition', rules: [{ when: { variable: 'a', op: 'eq' }, next: 'fin' }], else: 'fin' }, end('fin')], {
        variables: [variable('a')],
      }),
      flowOf([jump('a', 'b'), jump('b', 'a'), end('fin')], {}),
    ];
    // el último flujo es un ciclo sin salida al end: se completa añadiendo una rama alcanzable
    flows[3] = flowOf(
      [
        { id: 'c', type: 'condition', rules: [{ when: { variable: 'a', op: 'eq', value: 'nunca' }, next: 'fin' }], else: 'j' },
        jump('j', 'c'),
        end('fin'),
      ],
      { variables: [variable('a')] },
    );
    const results: AdvanceResult[] = [];
    for (const flow of flows) results.push(await startSession({ flow }));
    results.push(await startSession({ flow: flowOf([input('p', 'v', 'text', 'fin', { validation: { pattern: '(' } }), end('fin')], { variables: [variable('v')] }) }));
    const asking = flowOf([input('p', 'v', 'email', 'fin', { validation: { maxRetries: 0 } }), end('fin')], { variables: [variable('v')] });
    const waiting = (await startSession({ flow: asking })) as SessionResult;
    results.push(await continueSession({ flow: asking, state: waiting.state, input: { text: 'no' } }));
    // códigos de http: cada uno con un host que los provoca
    const okHost = always(respond(200)).host;
    const cycle = flowOf(
      [httpNode('h', {}, { next: 'c', onError: 'c' }), { id: 'c', type: 'condition', rules: [{ when: { variable: 'a', op: 'eq', value: 'nunca' }, next: 'fin' }], else: 'h' }, end('fin')],
      { variables: [variable('a')] },
    );
    results.push(await startSession({ flow: httpFlow({ headers: { 'X Bad': 'v' } }), }, okHost));
    results.push(await startSession({ flow: httpFlow() }, always({ kind: 'missing_secret' }).host));
    results.push(await startSession({ flow: httpFlow() }, always(null).host));
    results.push(await startSession({ flow: cycle }, okHost));
    for (const result of results) {
      if (result.ok) result.events.forEach((e) => e.type === 'error' && emitted.add(e.code));
    }
    expect([...emitted].sort()).toEqual([...SESSION_ERROR_CODES].sort());
  });

  it('todo código de rechazo emitido está en REJECTION_CODES', async () => {
    const good = flowOf([end('fin')]);
    const { state } = (await startSession({ flow: good })) as { state: unknown };
    const asking = flowOf([input('p', 'v', 'text', 'fin'), end('fin')], { variables: [variable('v')] });
    const waiting = (await startSession({ flow: asking })) as SessionResult;
    const results = [
      await continueSession({ flow: asking, state: waiting.state, input: null }),
      await startSession({ flow: {} }),
      await startSession({ flow: good, contact: [] }),
      await continueSession({ flow: good, state: {}, input: null }),
      await continueSession({ flow: flowOf([end('fin')], { id: 'otro' }), state, input: null }),
      await continueSession({ flow: good, state, input: null }),
    ];
    const emitted = results.map((r) => (r.ok ? null : r.code));
    expect(new Set(emitted)).toEqual(new Set(REJECTION_CODES));
  });

  it('los códigos de error de los fixtures y ejemplos pertenecen a la lista', async () => {
    for (const { label, flow } of allFlows()) {
      const result = await startSession({ flow: deepFreeze(structuredClone(flow)) });
      if (!result.ok) {
        expect(REJECTION_CODES as readonly string[], label).toContain(result.code);
        continue;
      }
      for (const event of result.events) {
        if (event.type === 'error') expect(SESSION_ERROR_CODES as readonly string[], label).toContain(event.code);
      }
    }
  });
});

describe('paridad de inputType y de defaults', () => {
  const inputNode = schema.$defs.inputNode.properties as unknown as {
    inputType: { enum: string[] };
    validation: { properties: { maxRetries: { default: number } } };
    multiple: { default?: boolean };
  };

  it('los inputType del esquema son las claves de PARSERS más choice', () => {
    expect([...inputNode.inputType.enum].sort()).toEqual([...Object.keys(PARSERS), 'choice'].sort());
  });

  it('el default de maxRetries del esquema es el que usa el motor (3 reintentos)', async () => {
    expect(inputNode.validation.properties.maxRetries.default).toBe(3);
    const flow = flowOf([input('p', 'v', 'email', 'fin'), end('fin')], { variables: [variable('v')] });
    let state = ((await startSession({ flow })) as SessionResult).state;
    const attempts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const result = (await continueSession({ flow, state, input: { text: 'no' } })) as SessionResult;
      attempts.push(result.state.attempt ?? 0);
      state = result.state;
    }
    expect(attempts).toEqual([2, 3, 4, 0]);
    expect(state.error?.code).toBe('retries_exhausted');
  });

  it('el default de locale del esquema es es', () => {
    expect((schema.properties as unknown as { locale: { default?: string } }).locale.default ?? 'es').toBe('es');
  });

  it('multiple no tiene default true en el esquema', () => {
    expect(inputNode.multiple.default ?? false).toBe(false);
  });
});

describe('reason emitidos', () => {
  it('cada reason de INVALID_ANSWER_REASONS se emite y ninguno fuera de la lista', async () => {
    const flow = flowOf(
      [input('p', 'v', 'text', 'fin', { validation: { min: 3, pattern: '^a+$', maxRetries: 10 } }), end('fin')],
      { variables: [variable('v')] },
    );
    const { state } = (await startSession({ flow })) as SessionResult;
    const answers = ['a'.repeat(4097), '  ', 'x\u0000', 'aa', 'bbb'];
    const seen = new Set<string>();
    for (const text of answers) {
      const result = (await continueSession({ flow, state, input: { text } })) as SessionResult;
      for (const event of result.events) if (event.type === 'input' && event.reason) seen.add(event.reason);
    }
    expect([...seen].sort()).toEqual([...INVALID_ANSWER_REASONS].sort());
  });
});

describe('paridad de http con flow.schema.json', () => {
  const httpProps = schema.$defs.httpNode.properties as unknown as {
    request: { properties: { method: { enum: string[] } } };
    timeoutMs: { default: number };
    retries: { default: number };
  };

  it('IDEMPOTENT tiene exactamente los métodos del esquema', () => {
    expect(Object.keys(IDEMPOTENT).sort()).toEqual([...httpProps.request.properties.method.enum].sort());
  });

  it('los defaults de timeoutMs y retries del esquema son las constantes del motor', () => {
    expect(httpProps.timeoutMs.default).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(httpProps.retries.default).toBe(DEFAULT_HTTP_RETRIES);
  });

  it('el motor aplica esos defaults: timeoutMs 10000 y 1 reintento', async () => {
    const host = scriptedHost([respond(503), respond(503)]);
    await startSession({ flow: httpFlow() }, host.host);
    expect(host.requests.map((r) => r.timeoutMs)).toEqual([10000, 10000]);
    expect(host.requests).toHaveLength(2);
  });

  it('cada motivo de HTTP_ERROR_REASONS se emite y ninguno fuera de la lista', async () => {
    const big = variable('a', { default: 'a'.repeat(16000) });
    const cases: [Record<string, unknown>, Record<string, unknown>, Step, Record<string, unknown>[]][] = [
      [{ url: 'ftp://api.example.com/' }, {}, respond(200), []],
      [{ headers: { 'X-V': 'Jos\u00e9' } }, {}, respond(200), []],
      [{ method: 'POST', body: ['{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}'] }, {}, respond(200), [big]],
      [{}, { retries: 0 }, respond(404), []],
      [{}, { retries: 0 }, { kind: 'timeout' }, []],
      [{}, { retries: 0 }, { kind: 'network_error' }, []],
      [{}, { retries: 0 }, { kind: 'blocked' }, []],
      [{}, { retries: 0 }, { kind: 'response_too_large' }, []],
      [{}, { responseMap: [{ variable: 'v', pointer: '/x' }] }, respond(200, 'no json'), []],
    ];
    const seen = new Set<string>();
    for (const [request, extra, step, variables] of cases) {
      const result = await startSession({ flow: httpFlow(request, extra, { variables: [variable('v'), ...variables] }) }, always(step).host);
      if (!result.ok) throw new Error(JSON.stringify(result));
      for (const event of result.events) if (event.type === 'http' && event.error !== null) seen.add(event.error);
    }
    expect([...seen].sort()).toEqual([...HTTP_ERROR_REASONS].sort());
  });
});

