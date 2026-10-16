import { describe, expect, it } from 'vitest';
import { continueSession, startSession, type AdvanceResult, type EngineHost } from '../src/index.js';
import { end, flowOf, httpNode, input, variable, type Obj } from './helpers/flows.js';
import { prng } from './helpers/regex.js';

/**
 * Flujos con un `http` configurado al azar (cabeceras, body, URL, punteros, método, reintentos) y hosts
 * que devuelven, lanzan o rechazan cosas al azar. Se comprueban invariantes, no valores: la promesa
 * nunca se rechaza, el estado es JSON, hay un único evento terminal, el presupuesto se respeta y ningún
 * marcador sensible aparece en eventos, errores ni estado.
 */
const SECRET = 'ZQXJ-QA3-SECRETO';
const PII = 'zqxj-qa3-pii@example.com';

const URLS = [
  'https://api.example.com/', 'https://api.example.com/{{v}}', 'https://api.example.com/x?q={{p}}', 'https://{{s}}.example.com/', 'http{{s}}://api.example.com:{{port}}/',
  'http://localhost/', 'http://127.0.0.1/{{v}}', 'ftp://api.example.com/', 'https://api.example.com/../x', 'https://api.example.com/{{dots}}', 'https://user@api.example.com/',
  'https://api.example.com/\u200b', 'https://{{h}}/', 'https://api.example.com:8443/a/{{p}}/b', 'https://api.example.com/#x', 'https://exa%41mple.com/', 'https://api.example.com/{{long}}',
];
const HEADER_SETS: Obj[] = [
  {}, { Accept: 'application/json' }, { Authorization: { secret: 'CRM_TOKEN' } }, { 'X-E': '{{email}}' }, { 'X-V': '{{v}}' }, { 'X Bad': 'x' }, { 'content-type': 'text/plain' },
  { 'Content-Type': 'a', 'content-type': 'b' }, { Host: 'x' }, { 'X-Long': '{{long}}' }, { 'X-N': 'é' }, { 'X-A': 'a', '2': 'b', '1': { secret: 'TWO' } },
];
const BODIES: unknown[] = [undefined, null, 'texto {{v}}', { a: '{{email}}', b: [1, '{{p}}'], c: null }, [], { '{{v}}': '{{v}}' }, 5, true, { deep: { deeper: ['{{long}}', '{{long}}', '{{long}}', '{{long}}', '{{long}}'] } }];
const POINTERS = ['', '/', '/a', '/a/b', '/lista/0', '/lista/-', '/n', '/o', '/~0', '/~1', '/a~2', '/__proto__', '/big'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const BODIES_OF_RESPONSE = [
  '', '{}', '{"a":{"b":"ok"},"lista":[1,2],"n":3,"o":{"x":null}}', '[1,2]', 'null', '<html>', '{"__proto__":{"x":1},"a":"y"}', `{"a":"${SECRET}"}`, '{"big":"' + 'x'.repeat(16385) + '"}', '{"a":"\\u0000"}', '{"a":1e999}',
  '{"a":"\\ud800"}', '[' .repeat(120) + ']'.repeat(120),
];

function hostStep(rand: () => number): unknown {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  if (rand() < 0.4) return { kind: 'response', status: pick([200, 201, 204]), body: pick(['', '{}', '{"a":{"b":"ok"},"lista":[1,2],"n":3,"o":{"x":null}}']) };
  switch (Math.floor(rand() * 16)) {
    case 0: return { kind: 'response', status: pick([200, 201, 204, 301, 404, 429, 500, 503]), body: pick(BODIES_OF_RESPONSE) };
    case 1: return { kind: 'response', status: pick([100, 199, 600, 200.5, '200', null]), body: '' };
    case 2: return { kind: 'response', status: 200, body: pick([5, null, {}, undefined]) };
    case 3: return { kind: 'timeout' };
    case 4: return { kind: 'network_error', requestSent: pick([true, false, undefined, 'no', 0]) };
    case 5: return { kind: 'blocked' };
    case 6: return { kind: 'response_too_large' };
    case 7: return { kind: 'missing_secret', secret: SECRET };
    case 8: return () => { throw new Error(SECRET + PII); };
    case 9: return () => Promise.reject(new Error(SECRET));
    case 10: return null;
    case 11: return { kind: 'otro', authorization: SECRET };
    case 12: return new Proxy({ kind: 'response', status: 200, body: '{}' }, { get: () => { throw new Error(SECRET); } });
    case 13: return { then() { throw new Error(SECRET); } };
    case 14: return { kind: 'response', status: 200, body: '{"a":"ok"}', headers: { 'set-cookie': SECRET } };
    default: return 'cadena';
  }
}

function flowFor(rand: () => number): Obj {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const method = pick(METHODS);
  const body = BODIES[Math.floor(rand() * BODIES.length)];
  const request: Obj = { method, url: pick(URLS), headers: pick(HEADER_SETS) };
  if (body !== undefined) request.body = body;
  const entries = Array.from({ length: Math.floor(rand() * 3) }, (_, i) => ({ variable: pick(['r0', 'r1', 'r2']), pointer: pick(POINTERS) }));
  return flowOf(
    [
      httpNode('h', request, { retries: Math.floor(rand() * 6), next: 'p', onError: 'e', ...(entries.length ? { responseMap: entries } : {}), ...(rand() < 0.3 ? { timeoutMs: 100 + Math.floor(rand() * 1000) } : {}) }),
      input('p', 'w', 'text', 'fin'),
      end('e', { outcome: 'ko' }),
      end('fin', { outcome: 'ok' }),
    ],
    {
      variables: [
        variable('v', { default: pick(['a b', '..', 'x/y', '', 'ñ', '%2e']) }),
        variable('p', { default: pick(['1', '?', '#', 'a&b=c']) }),
        variable('s', { default: pick(['api', 's', 'evil.com/', '']) }),
        variable('h', { default: pick(['evil.com', '127.0.0.1', 'localhost', 'api.example.com']) }),
        variable('port', { default: pick(['8080', '', '99999']) }),
        variable('dots', { default: pick(['..', '.', '%2e%2e', 'a']) }),
        variable('long', { default: 'l'.repeat(pick([10, 8200, 16384])) }),
        variable('email', { default: PII, pii: true }),
        variable('r0', { type: 'json' }),
        variable('r1', { type: 'json' }),
        variable('r2', { type: 'json' }),
        variable('w'),
      ],
    },
  );
}

describe('propiedades sobre nodos http configurados y hosts al azar', () => {
  it('600 ejecuciones: la promesa nunca se rechaza, el estado es JSON y nada sensible se filtra', async () => {
    const rand = prng(20261019);
    let waiting = 0;
    let failed = 0;
    let withCalls = 0;
    for (let i = 0; i < 600; i++) {
      const flow = flowFor(rand);
      const steps = Array.from({ length: 12 }, () => hostStep(rand));
      let calls = 0;
      const host: EngineHost = {
        http: (async () => {
          const step = steps[calls++ % steps.length];
          return typeof step === 'function' ? (step as () => unknown)() : step;
        }) as unknown as EngineHost['http'],
      };
      let result: AdvanceResult;
      try {
        result = await startSession({ flow }, host);
      } catch (error) {
        throw new Error(`la promesa se rechazó (${String(error)}) con ${JSON.stringify(flow)}`);
      }
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) continue;
      expect(calls).toBeLessThanOrEqual(10);
      if (calls > 0) withCalls++;
      expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
      const terminal = result.events.filter((e) => e.type === 'input' || e.type === 'end' || e.type === 'error');
      expect(terminal).toHaveLength(1);
      expect(result.events.at(-1)).toBe(terminal[0]);
      expect(result.events.filter((e) => e.type === 'http').length).toBeLessThanOrEqual(1);
      const text = JSON.stringify([result.events, result.state.error, result.state.nodeId]);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(PII);
      // Lo que llega al estado desde la respuesta solo está en las variables de su responseMap.
      expect(JSON.stringify({ ...result.state.variables, r0: undefined, r1: undefined, r2: undefined })).not.toContain(SECRET);
      if (result.status === 'waiting') {
        waiting++;
        const done = await continueSession({ flow, state: JSON.parse(JSON.stringify(result.state)), input: { text: 'hola' } }, host);
        expect(done.ok).toBe(true);
        if (done.ok) expect(done.status).toBe('ended');
      } else if (result.status === 'failed') failed++;
    }
    expect(waiting).toBeGreaterThan(30);
    expect(failed).toBeGreaterThan(30);
    expect(withCalls).toBeGreaterThan(80);
  });

  it('el motor entrega exactamente las mismas peticiones en dos ejecuciones con el mismo guion', async () => {
    const rand = prng(77);
    for (let i = 0; i < 150; i++) {
      const flow = flowFor(rand);
      const steps = Array.from({ length: 12 }, () => hostStep(rand));
      const run = async () => {
        const seen: unknown[] = [];
        let calls = 0;
        const host: EngineHost = {
          http: (async (request: unknown) => {
            seen.push(structuredClone(request));
            const step = steps[calls++ % steps.length];
            return typeof step === 'function' ? (step as () => unknown)() : step;
          }) as unknown as EngineHost['http'],
        };
        return { result: await startSession({ flow }, host), seen };
      };
      const a = await run();
      const b = await run();
      expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
      expect(a.seen).toEqual(b.seen);
    }
  });
});
