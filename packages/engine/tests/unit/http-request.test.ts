import type { Flow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { MAX_REQUEST_BODY_LENGTH } from '../../src/constants.js';
import { personalVariables, prepareRequest, requestFor, type RequestStats } from '../../src/http/request.js';
import { ValueTooLargeError } from '../../src/template.js';
import type { VariableValue } from '../../src/types.js';
import { flowOf, setNode, variable } from '../helpers/flows.js';
import { node } from '../helpers/http-node.js';

const vars = (values: Record<string, VariableValue> = {}) => (name: string) => (Object.hasOwn(values, name) ? values[name] : undefined);
const NO_PII = new Set<string>();

/** Prepara y exige que la petición se construya. */
function prepared(request: Record<string, unknown>, values: Record<string, VariableValue> = {}, pii: ReadonlySet<string> = NO_PII, extra = {}) {
  const result = prepareRequest(node(request, extra), vars(values), pii);
  if (!result.ok) throw new Error(`no se pudo construir: ${result.reason}`);
  return result.request;
}
const failure = (request: Record<string, unknown>, values: Record<string, VariableValue> = {}) => {
  const result = prepareRequest(node(request), vars(values), NO_PII);
  return result.ok ? null : result.reason;
};

describe('petición mínima', () => {
  it('sin cabeceras ni body', () => {
    expect(prepared({ url: 'https://api.example.com' })).toEqual({
      nodeId: 'h',
      method: 'GET',
      url: 'https://api.example.com/',
      headers: [],
      body: null,
      timeoutMs: 10000,
      containsPii: false,
    });
  });

  it('timeoutMs del nodo', () => {
    expect(prepared({}, {}, NO_PII, { timeoutMs: 8000 }).timeoutMs).toBe(8000);
  });
});

describe('cabeceras', () => {
  it('secreto por nombre y plantilla, en el orden del flujo', () => {
    const request = prepared({ headers: { Authorization: { secret: 'CRM_TOKEN' }, 'X-Lead': 'lead {{nombre}}' } }, { nombre: 'Ana' });
    expect(request.headers).toEqual([
      { name: 'Authorization', secret: 'CRM_TOKEN' },
      { name: 'X-Lead', value: 'lead Ana' },
    ]);
  });

  it('el orden de la forma JSON: los nombres que son índices van primero', () => {
    const flow = JSON.parse('{"headers": {"X-A": "1", "2": "2", "1": "1", "b": "b"}}');
    expect(prepared(flow).headers.map((h) => h.name)).toEqual(['1', '2', 'X-A', 'b']);
  });

  it('__proto__ y constructor son nombres normales', () => {
    const flow = JSON.parse('{"headers": {"__proto__": "a", "constructor": "b"}}');
    expect(prepared(flow).headers).toEqual([
      { name: '__proto__', value: 'a' },
      { name: 'constructor', value: 'b' },
    ]);
  });

  it('Content-Type por defecto al final cuando hay body y ninguna cabecera lo define', () => {
    expect(prepared({ method: 'POST', body: { a: 1 } }).headers).toEqual([{ name: 'Content-Type', value: 'application/json' }]);
    expect(prepared({ method: 'POST', body: { a: 1 }, headers: { 'X-A': 'v' } }).headers.map((h) => h.name)).toEqual(['X-A', 'Content-Type']);
  });

  it.each(['content-type', 'CONTENT-TYPE', 'Content-type', 'cOnTeNt-TyPe'])('una cabecera %s evita el Content-Type por defecto', (name) => {
    expect(prepared({ method: 'POST', body: { a: 1 }, headers: { [name]: 'text/plain' } }).headers).toEqual([{ name, value: 'text/plain' }]);
  });

  it('Content-Type como secreto también cuenta', () => {
    expect(prepared({ method: 'POST', body: 1, headers: { 'Content-Type': { secret: 'S' } } }).headers).toEqual([{ name: 'Content-Type', secret: 'S' }]);
  });

  it('sin body no se añade Content-Type', () => {
    expect(prepared({ method: 'POST', body: null }).headers).toEqual([]);
    expect(prepared({ method: 'POST' }).headers).toEqual([]);
  });

  it('no cuenta en el límite de 32: el Content-Type lo pone el motor', () => {
    const headers = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`X-H${i}`, 'v']));
    expect(prepared({ method: 'POST', body: {}, headers }).headers).toHaveLength(33);
  });
});

describe('valores de cabecera', () => {
  const headerOf = (value: string) => failure({ headers: { 'X-V': value } });

  it('U+0020-U+007E y tabulador se admiten', () => {
    for (let code = 0x20; code <= 0x7e; code++) expect(headerOf(`a${String.fromCharCode(code)}b`), code.toString(16)).toBeNull();
    expect(headerOf('a\tb')).toBeNull();
  });

  it('el resto de U+0000 a U+007F se rechaza', () => {
    for (let code = 0; code <= 0x7f; code++) {
      if (code === 0x09 || (code >= 0x20 && code <= 0x7e)) continue;
      expect(headerOf(`a${String.fromCharCode(code)}b`), code.toString(16)).toBe('invalid_header_value');
    }
  });

  it('no ASCII y sustitutos se rechazan', () => {
    for (const value of ['José', '中', '\u{1F600}', 'a\ud800', '\udc00', '\u0080', '\u00a0', '\u2028']) {
      expect(headerOf(value), JSON.stringify(value)).toBe('invalid_header_value');
    }
  });

  it('un valor insertado no puede partir la petición', () => {
    expect(failure({ headers: { 'X-V': '{{v}}' } }, { v: 'Ana\r\nX-Admin: 1' })).toBe('invalid_header_value');
  });

  it('vacío y Bearer con valor se admiten', () => {
    expect(prepared({ headers: { 'X-Vacia': '' } }).headers).toEqual([{ name: 'X-Vacia', value: '' }]);
    expect(prepared({ headers: { Authorization: 'Bearer {{t}}' } }, { t: 'abc.def-123' }).headers).toEqual([
      { name: 'Authorization', value: 'Bearer abc.def-123' },
    ]);
  });

  it('un secreto no se valida: no tiene valor en el motor', () => {
    expect(prepared({ headers: { Authorization: { secret: 'café con espacios' } } }).headers).toHaveLength(1);
  });

  it('16384 unidades en un valor se admiten (si son ASCII) y 16385 lanzan value_too_large', () => {
    expect(failure({ headers: { 'X-V': 'a'.repeat(16384) } })).toBeNull();
    expect(() => prepareRequest(node({ headers: { 'X-V': 'a'.repeat(16385) } }), vars(), NO_PII)).toThrow(ValueTooLargeError);
  });
});

describe('body', () => {
  const body = (value: unknown, values: Record<string, VariableValue> = {}) => prepared({ method: 'POST', body: value }, values).body;

  it('plantillas en los strings, claves literales', () => {
    expect(
      body({ nombre: '{{nombre}}', edad: '{{n}}', fijo: 3, ok: true, nada: null, tags: ['{{nombre}}'], '{{nombre}}': 'k' }, { nombre: 'Ana', n: 3 }),
    ).toBe('{"nombre":"Ana","edad":"3","fijo":3,"ok":true,"nada":null,"tags":["Ana"],"{{nombre}}":"k"}');
  });

  it('body string, array, número, booleano y null', () => {
    expect(body('hola {{nombre}}', { nombre: 'Ana' })).toBe('"hola Ana"');
    expect(body(['{{a}}', 1], { a: 'x' })).toBe('["x",1]');
    expect(body(5)).toBe('5');
    expect(body(false)).toBe('false');
    expect(prepared({ method: 'POST', body: null }).body).toBeNull();
    expect(prepared({ method: 'POST' }).body).toBeNull();
  });

  it('orden de las claves de la forma JSON y claves __proto__ y constructor', () => {
    const parsed = JSON.parse('{"b": 1, "2": 2, "a": {"z": 0, "1": 1}}');
    expect(body(parsed)).toBe('{"2":2,"b":1,"a":{"1":1,"z":0}}');
    const named = JSON.parse('{"__proto__": "{{nombre}}", "constructor": 1}');
    expect(body(named, { nombre: 'Ana' })).toBe('{"__proto__":"Ana","constructor":1}');
  });

  it('un sustituto suelto de una variable sale como escape JSON válido', () => {
    const text = body({ t: '{{v}}' }, { v: 'a\ud800' })!;
    expect(JSON.parse(text)).toEqual({ t: 'a\ud800' });
  });

  it('64013 unidades se admiten y 80016 son body_too_large', () => {
    const values = { a: 'a'.repeat(16000) };
    const four = prepared({ method: 'POST', body: ['{{a}}', '{{a}}', '{{a}}', '{{a}}'] }, values).body!;
    expect(four).toHaveLength(64013);
    expect(failure({ method: 'POST', body: ['{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}'] }, values)).toBe('body_too_large');
  });

  it('el límite es exacto: 65536 se admite y 65537 no', () => {
    // k trozos de «x» como array JSON: t + 3k + 1 unidades; con k = 5, t = 65520 da 65536
    const chunks = (total: number) => Array.from({ length: Math.ceil(total / 16000) }, (_, i) => 'x'.repeat(Math.min(16000, total - i * 16000)));
    expect(JSON.stringify(chunks(65520))).toHaveLength(MAX_REQUEST_BODY_LENGTH);
    expect(prepared({ method: 'POST', body: chunks(65520) }).body).toHaveLength(MAX_REQUEST_BODY_LENGTH);
    expect(JSON.stringify(chunks(65521))).toHaveLength(MAX_REQUEST_BODY_LENGTH + 1);
    expect(failure({ method: 'POST', body: chunks(65521) })).toBe('body_too_large');
  });

  it('value_too_large en un string anidado del body', () => {
    const tooBig = { a: 'a'.repeat(16385) };
    expect(() => prepareRequest(node({ method: 'POST', body: { x: [{ y: '{{a}}' }] } }), vars(tooBig), NO_PII)).toThrow(ValueTooLargeError);
  });

  it('value_too_large en un string posterior a superar 65536', () => {
    const values = { a: 'a'.repeat(16000), big: 'b'.repeat(16385) };
    const doc = ['{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{big}}'];
    expect(() => prepareRequest(node({ method: 'POST', body: doc }), vars(values), NO_PII)).toThrow(ValueTooLargeError);
  });

  it('el value_too_large gana a body_too_large aunque este ya fuera seguro', () => {
    const values = { a: 'a'.repeat(16384) };
    expect(failure({ method: 'POST', body: ['{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}'] }, values)).toBe('body_too_large');
    expect(() =>
      prepareRequest(node({ method: 'POST', body: ['{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}!'] }), vars(values), NO_PII),
    ).toThrow(ValueTooLargeError);
  });

  it('máximo retenido ≤ 65536 + 16384 con 1000 strings de 16384', () => {
    const stats: RequestStats = { maxRetained: 0 };
    const doc = Array.from({ length: 1000 }, () => '{{a}}');
    const result = prepareRequest(node({ method: 'POST', body: doc }), vars({ a: 'a'.repeat(16384) }), NO_PII, stats);
    expect(result).toEqual({ ok: false, reason: 'body_too_large' });
    expect(stats.maxRetained).toBeLessThanOrEqual(MAX_REQUEST_BODY_LENGTH + 16384);
    expect(stats.maxRetained).toBeGreaterThan(MAX_REQUEST_BODY_LENGTH); // el contador no está a cero: se renderizó de verdad
  });
});

describe('orden de comprobación URL → cabeceras → body', () => {
  it('la URL gana a las cabeceras y al body', () => {
    expect(failure({ method: 'POST', url: 'http://localhost/', headers: { 'X-V': 'José' }, body: ['a'.repeat(16000), 'a'.repeat(16000), 'a'.repeat(16000), 'a'.repeat(16000), 'a'.repeat(16000)] })).toBe('invalid_url');
  });

  it('las cabeceras ganan al body', () => {
    expect(failure({ method: 'POST', headers: { 'X-V': 'José' }, body: Array(5).fill('a'.repeat(16000)) })).toBe('invalid_header_value');
  });

  it('la primera cabecera inválida en el orden del flujo', () => {
    expect(failure({ headers: { 'X-A': 'ok', 'X-B': 'José', 'X-C': 'ñ' } })).toBe('invalid_header_value');
  });
});

describe('containsPii', () => {
  const pii = new Set(['email']);
  const pii$ = (request: Record<string, unknown>) => prepared(request, {}, pii).containsPii;

  it('por url, cabecera y body', () => {
    expect(pii$({ url: 'https://api.example.com/?e={{email}}' })).toBe(true);
    expect(pii$({ headers: { 'X-Email': '{{email}}' } })).toBe(true);
    expect(pii$({ method: 'POST', body: { a: [{ b: '{{email}}' }] } })).toBe(true);
    expect(pii$({ method: 'POST', body: '{{ email }}' })).toBe(true);
  });

  it('una variable no pii o ninguna', () => {
    expect(pii$({ method: 'POST', body: { s: '{{segmento}}' } })).toBe(false);
    expect(pii$({ url: 'https://api.example.com/' })).toBe(false);
  });

  it('no por las claves del body ni por responseMap ni por secretos', () => {
    expect(pii$({ method: 'POST', body: { '{{email}}': 1 } })).toBe(false);
    expect(prepared({}, {}, pii, { responseMap: [{ variable: 'email', pointer: '/e' }] }).containsPii).toBe(false);
    expect(pii$({ headers: { 'X-Email': { secret: 'email' } } })).toBe(false);
  });

  it('cuenta aunque la variable no tenga valor', () => {
    expect(pii$({ headers: { 'X-Email': '{{email}}' } })).toBe(true);
  });
});

describe('requestFor', () => {
  it('objeto y lista de cabeceras nuevos por intento', () => {
    const base = prepared({ headers: { 'X-A': '1' } });
    const first = requestFor(base, 1);
    first.headers.length = 0;
    first.url = 'https://evil.example/';
    const second = requestFor(base, 2);
    expect(second).toEqual({ ...base, attempt: 2 });
    expect(second.headers).not.toBe(base.headers);
    expect(second.headers[0]).not.toBe(base.headers[0]);
    expect(second.headers).toHaveLength(1);
  });
});

describe('personalVariables: cierre estático por set', () => {
  const flow = (variables: Record<string, unknown>[], nodes: Record<string, unknown>[]): Flow =>
    flowOf([...nodes, { id: 'fin', type: 'end' }], { variables }) as unknown as Flow;
  const personal = (...args: Parameters<typeof flow>) => [...personalVariables(flow(...args))].sort();

  it('parte de las declaradas con pii: true', () => {
    expect(personal([variable('email', { pii: true }), variable('x')], [setNode('s', [['x', 'a']], 'fin')])).toEqual(['email']);
  });

  it('copia directa y cadena de 5 set en orden inverso de declaración', () => {
    const vars = ['email', 'a', 'b', 'c', 'd', 'e'].map((n) => variable(n, n === 'email' ? { pii: true } : {}));
    const chain = [
      setNode('s5', [['e', '{{d}}']], 'fin'),
      setNode('s4', [['d', '{{c}}']], 's5'),
      setNode('s3', [['c', '{{b}}']], 's4'),
      setNode('s2', [['b', '{{a}}']], 's3'),
      setNode('s1', [['a', 'Hola {{email}}']], 's2'),
    ];
    expect(personal(vars, chain)).toEqual(['a', 'b', 'c', 'd', 'e', 'email']);
  });

  it('un set en una rama que no se ejecuta cuenta igual', () => {
    const vars = [variable('email', { pii: true }), variable('x')];
    const flowDoc = flowOf(
      [
        { id: 'c', type: 'condition', rules: [{ when: { variable: 'x', op: 'eq', value: 'nunca' }, next: 'rama' }], else: 'fin' },
        setNode('rama', [['x', '{{email}}']], 'fin'),
        { id: 'fin', type: 'end' },
      ],
      { variables: vars },
    ) as unknown as Flow;
    expect([...personalVariables(flowDoc)].sort()).toEqual(['email', 'x']);
  });

  it('un set sin plantilla pii, con literales o null no propaga', () => {
    const vars = [variable('email', { pii: true }), variable('a'), variable('b'), variable('c')];
    const nodes = [setNode('s', [['a', 'sin datos'], ['b', null], ['c', 3]], 'fin')];
    expect(personal(vars, nodes)).toEqual(['email']);
  });

  it('un nombre repetido con alguna declaración pii cuenta', () => {
    expect(personal([variable('e'), variable('e', { pii: true })], [setNode('s', [['e', 'a']], 'fin')])).toEqual(['e']);
  });

  it('no se propaga por input, condition ni responseMap', () => {
    const vars = [variable('email', { pii: true }), variable('r')];
    const nodes = [
      { id: 'h', type: 'http', request: { method: 'GET', url: 'https://api.example.com/' }, responseMap: [{ variable: 'r', pointer: '/e' }], next: 'fin', onError: 'fin' },
    ];
    expect(personal(vars, nodes)).toEqual(['email']);
  });

  it('sin variables no hay personales', () => {
    expect(personal([], [])).toEqual([]);
  });
});
