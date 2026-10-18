import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { timed } from './helpers/flows.js';

/**
 * Flujos de ~1 MiB (el tope del cuerpo de la API) con la parte ancha en sitios distintos: cada array o mapa que el
 * esquema recorre elemento a elemento, con elementos válidos y rotos de varias formas. Ninguno debe lanzar, tardar
 * más de 10 s ni devolver más de 100 issues más el del tope.
 * Complementa a `shape-cost.test.ts`, que fija los escenarios de la spec con su presupuesto de 2 s.
 */
const LIMIT = 1_048_576;
// Lo que se descarta es un coste cuadrático, que sobre 1 MiB son minutos o nunca. En local cada forma tarda menos de
// 0,1 s, pero en el runner de la CI, con los tests de todos los paquetes a la vez, una lineal ya ha llegado a 2,2 s.
const BUDGET_MS = 10_000;
const HEAVY = { timeout: 30_000 };

const base = (over: Record<string, unknown> = {}): any => ({
  specVersion: '0.1',
  id: 'f',
  name: 'F',
  start: 'a',
  nodes: [{ id: 'a', type: 'end' }],
  ...over,
});
const END = { id: 'a', type: 'end' };
const TEXT = [{ kind: 'text', text: 'x' }];

/** Elementos `make(i)` hasta llenar ~1 MiB de texto JSON junto con el resto del flujo. */
function fill(make: (index: number) => unknown, reserved = 4000): unknown[] {
  const items: unknown[] = [];
  let size = reserved;
  for (let index = 0; ; index++) {
    const item = make(index);
    size += JSON.stringify(item).length + 1;
    if (size > LIMIT - 100) return items;
    items.push(item);
  }
}

/** Un objeto con claves `key(i)` y valores `value(i)` hasta llenar ~1 MiB. */
function fillObject(key: (index: number) => string, value: (index: number) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let size = 4000;
  for (let index = 0; ; index++) {
    const k = key(index);
    const v = value(index);
    size += JSON.stringify(k).length + JSON.stringify(v).length + 2;
    if (size > LIMIT - 100) return out;
    out[k] = v;
  }
}

const http = (request: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'h',
  type: 'http',
  request: { method: 'POST', url: 'https://x.example.com/a', ...request },
  next: 'a',
  onError: 'a',
  ...extra,
});
const node = (over: Record<string, unknown>) => ({ id: 'n', ...over });

interface Shape {
  name: string;
  build: () => any;
  /** Veredicto esperado. */
  valid: boolean;
}

const SHAPES: Shape[] = [
  { name: 'variables válidas', valid: true, build: () => base({ variables: fill((i) => ({ name: `v${i}`, type: 'string' })) }) },
  { name: 'variables {x: 1}', valid: false, build: () => base({ variables: fill(() => ({ x: 1 })) }) },
  { name: 'variables nulas', valid: false, build: () => base({ variables: fill(() => null) }) },
  { name: 'variables arrays anidados', valid: false, build: () => base({ variables: fill(() => [[[1]]]) }) },
  { name: 'variables con nombre y tipo malos', valid: false, build: () => base({ variables: fill((i) => ({ name: `1 ${i}`, type: 'zzz', scope: 'q', pii: 1 })) }) },
  { name: 'un default json de ~1 MiB', valid: true, build: () => base({ variables: [{ name: 'j', type: 'json', default: fill((i) => ({ a: i })) }] }) },
  { name: 'un default json de 100 000 claves numéricas', valid: true, build: () => base({ variables: [{ name: 'j', type: 'json', default: Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => [String(i), i])) }] }) },
  { name: 'un default json de 400 000 elementos', valid: true, build: () => base({ variables: [{ name: 'j', type: 'json', default: Array.from({ length: 400_000 }, () => 1) }] }) },
  {
    name: 'nodos jump encadenados',
    valid: true,
    build: () => {
      const nodes: unknown[] = fill((i) => ({ id: `j${i}`, type: 'jump', target: `j${i + 1}` }));
      nodes.push({ id: `j${nodes.length}`, type: 'end' });
      return base({ start: 'j0', nodes });
    },
  },
  { name: 'nodos jump a destinos que no existen', valid: false, build: () => base({ nodes: [END, ...fill((i) => ({ id: `j${i}`, type: 'jump', target: `x${i}` }))] }) },
  { name: 'nodos con el mismo id', valid: false, build: () => base({ nodes: fill(() => ({ id: 'a', type: 'jump', target: 'a' })) }) },
  { name: 'nodos de tipo desconocido', valid: false, build: () => base({ nodes: fill((i) => ({ id: `a${i}`, type: 'zz' })) }) },
  { name: 'nodos nulos', valid: false, build: () => base({ nodes: fill(() => null) }) },
  { name: 'nodos con ids de 64 caracteres', valid: false, build: () => base({ nodes: [END, ...fill((i) => ({ id: `n${i}`.padEnd(64, 'x'), type: 'jump', target: 'a' }))] }) },
  { name: 'nodos message con variables sin declarar', valid: false, build: () => base({ nodes: [END, ...fill((i) => ({ id: `m${i}`, type: 'message', content: [{ kind: 'text', text: `{{u${i}}}` }], next: 'a' }))] }) },
  { name: 'un message con content ancho y roto', valid: false, build: () => base({ nodes: [END, node({ id: 'm', type: 'message', content: fill(() => ({})), next: 'a' })] }) },
  { name: 'un message con content ancho y válido', valid: false, build: () => base({ nodes: [END, node({ id: 'm', type: 'message', content: fill((i) => ({ kind: 'text', text: `t${i}` })), next: 'a' })] }) },
  {
    name: 'un input con choices anchas que saltan a nodos que no existen',
    valid: false,
    build: () => base({ variables: [{ name: 'v', type: 'string' }], nodes: [END, node({ id: 'i', type: 'input', prompt: TEXT, inputType: 'choice', variable: 'v', choices: fill((i) => ({ id: `c${i}`, label: 'l', next: `x${i}` })) })] }),
  },
  {
    name: 'un input con choices anchas, repetidas y sin next',
    valid: false,
    build: () => base({ variables: [{ name: 'v', type: 'string' }], nodes: [END, node({ id: 'i', type: 'input', prompt: TEXT, inputType: 'choice', variable: 'v', choices: fill(() => ({ id: 'c', label: 'l' })) })] }),
  },
  {
    name: 'un input con choices rotas',
    valid: false,
    build: () => base({ variables: [{ name: 'v', type: 'string' }], nodes: [END, node({ id: 'i', type: 'input', prompt: TEXT, inputType: 'choice', variable: 'v', choices: fill((i) => ({ id: `c${i}`, label: 1, value: [i] })) })] }),
  },
  { name: 'un set con assignments anchas y sin declarar', valid: false, build: () => base({ nodes: [END, node({ id: 's', type: 'set', assignments: fill((i) => ({ variable: `v${i}`, value: 1 })), next: 'a' })] }) },
  { name: 'un set con assignments rotas', valid: false, build: () => base({ nodes: [END, node({ id: 's', type: 'set', assignments: fill((i) => ({ variable: 'v', value: { a: i } })), next: 'a' })] }) },
  { name: 'un http con responseMap ancho y roto', valid: false, build: () => base({ nodes: [END, http({ method: 'GET' }, { responseMap: fill(() => ({})) })] }) },
  { name: 'un http con responseMap de punteros malos', valid: false, build: () => base({ nodes: [END, http({}, { responseMap: fill((i) => ({ variable: 'v', pointer: `x${i}` })) })] }) },
  { name: 'un http con un puntero de 500 000 segmentos', valid: false, build: () => base({ variables: [{ name: 'v', type: 'string' }], nodes: [END, http({}, { responseMap: [{ variable: 'v', pointer: `/${'a/'.repeat(500_000)}!` }] })] }) },
  { name: 'un http con cabeceras numéricas', valid: false, build: () => base({ nodes: [END, http({ headers: fillObject((i) => `H${i}`, (i) => i) })] }) },
  { name: 'un http con cabeceras de texto', valid: false, build: () => base({ nodes: [END, http({ headers: fillObject((i) => `H${i}`, () => 'v') })] }) },
  { name: 'un http con cabeceras que referencian secretos mal escritos', valid: false, build: () => base({ nodes: [END, http({ headers: fillObject((i) => `H${i}`, (i) => ({ secret: `minusculas${i}` })) })] }) },
  { name: 'un http con 30 000 marcadores distintos bajo 990 niveles', valid: false, build: () => { let body: unknown = Array.from({ length: 30_000 }, (_, i) => `{{m${i}}}`).join(','); for (let i = 0; i < 990; i++) body = [body]; return base({ nodes: [END, http({ body })] }); } },
  { name: 'un http con 990 niveles de objetos', valid: false, build: () => { let body: unknown = 'x'; for (let i = 0; i < 990; i++) body = { k: body, l: 'y'.repeat(300) }; return base({ nodes: [END, http({ body })] }); } },
  { name: 'un http con un body ancho de arrays', valid: false, build: () => base({ nodes: [END, http({ body: Array.from({ length: 5000 }, () => Array.from({ length: 30 }, (_, i) => `{{z${i}}}`)) })] }) },
  { name: 'un llm con slots anchos y rotos', valid: false, build: () => base({ nodes: [END, node({ id: 'l', type: 'llm', provider: 'p', goal: 'g', next: 'a', onExhausted: 'a', slots: fill(() => ({})) })] }) },
  { name: 'un llm con slots anchos y válidos', valid: false, build: () => base({ nodes: [END, node({ id: 'l', type: 'llm', provider: 'p', goal: 'g', next: 'a', onExhausted: 'a', slots: fill((i) => ({ variable: `v${i}`, description: 'd' })) })] }) },
  { name: 'un llm con 80 000 marcadores sin declarar', valid: false, build: () => base({ nodes: [END, node({ id: 'l', type: 'llm', provider: 'p', goal: Array.from({ length: 80_000 }, (_, i) => `{{g${i}}}`).join(' '), next: 'a', onExhausted: 'a' })] }) },
  {
    name: '120 conditions de ~8 KB con 2 700 predicados vacíos cada una (el peor caso del detalle de forma)',
    valid: false,
    build: () => {
      const when = { all: Array.from({ length: 2700 }, () => ({})) };
      const count = Math.floor(1_000_000 / JSON.stringify({ id: 'c000', type: 'condition', else: 'a', rules: [{ next: 'a', when }] }).length);
      return base({ nodes: [END, ...Array.from({ length: count }, (_, i) => ({ id: `c${i}`, type: 'condition', else: 'a', rules: [{ next: 'a', when }] }))] });
    },
  },
  { name: 'una condition con rules anchas y rotas', valid: false, build: () => base({ nodes: [END, node({ id: 'c', type: 'condition', else: 'a', rules: fill(() => ({})) })] }) },
  { name: 'una condition con rules anchas y variables sin declarar', valid: false, build: () => base({ nodes: [END, node({ id: 'c', type: 'condition', else: 'a', rules: fill((i) => ({ when: { variable: `w${i}`, op: 'isSet' }, next: 'a' })) })] }) },
  { name: 'un predicado any ancho y válido', valid: false, build: () => base({ nodes: [END, node({ id: 'c', type: 'condition', else: 'a', rules: [{ next: 'a', when: { any: fill((i) => ({ variable: `w${i}`, op: 'isSet' })) } }] })] }) },
  { name: 'un predicado any ancho y roto', valid: false, build: () => base({ nodes: [END, node({ id: 'c', type: 'condition', else: 'a', rules: [{ next: 'a', when: { any: fill(() => ({ variable: 1 })) } }] })] }) },
  { name: 'la raíz con 30 000 propiedades desconocidas', valid: false, build: () => fillObject((i) => `p${i}`, () => 1) as any },
  { name: 'la raíz con settings de 30 000 claves', valid: false, build: () => base({ settings: fillObject((i) => `k${i}`, () => 1) }) },
  { name: 'un name de ~1 MiB', valid: false, build: () => base({ name: 'x'.repeat(LIMIT - 500) }) },
  { name: 'una description de 200 000 emojis', valid: false, build: () => base({ description: '😀'.repeat(200_000) }) },
  { name: 'un message con 30 000 propiedades desconocidas', valid: false, build: () => base({ nodes: [END, { ...node({ id: 'm', type: 'message', content: TEXT, next: 'a' }), ...fillObject((i) => `p${i}`, () => 1) }] }) },
  { name: 'un input con 30 000 propiedades desconocidas', valid: false, build: () => base({ variables: [{ name: 'v', type: 'string' }], nodes: [END, { ...node({ id: 'i', type: 'input', prompt: TEXT, inputType: 'text', variable: 'v' }), ...fillObject((i) => `p${i}`, () => 1) }] }) },
  { name: 'un text de ~1 MiB de «{{» y espacios', valid: false, build: () => base({ nodes: [END, node({ id: 'm', type: 'message', content: [{ kind: 'text', text: `{{${' '.repeat(LIMIT - 1000)}x` }], next: 'a' })] }) },
  { name: 'un text de 4000 «{{a» seguidos de 200 espacios', valid: false, build: () => base({ nodes: [END, node({ id: 'm', type: 'message', content: [{ kind: 'text', text: `{{a${' '.repeat(200)}`.repeat(4000) }], next: 'a' })] }) },
  { name: 'un text de 500 000 «{{» seguidos', valid: false, build: () => base({ nodes: [END, node({ id: 'm', type: 'message', content: [{ kind: 'text', text: '{{'.repeat(500_000) }], next: 'a' })] }) },
  { name: 'una url de 150 000 marcadores con espacios', valid: false, build: () => base({ nodes: [END, http({ url: `${'{{a}} '.repeat(150_000)}` })] }) },
  { name: 'una regla matches con un patrón de 600 000 caracteres', valid: false, build: () => base({ variables: [{ name: 'q', type: 'string' }], nodes: [END, node({ id: 'c', type: 'condition', else: 'a', rules: [{ next: 'a', when: { variable: 'q', op: 'matches', value: '(a*)*b'.repeat(100_000) } }] })] }) },
];

describe('Coste acotado de la validación: flujos anchos de ~1 MiB en cada array y mapa', HEAVY, () => {
  it.each(SHAPES.map((shape) => [shape.name, shape] as const))('%s: no lanza, es lineal y el veredicto es el esperado', (_name, shape) => {
    const flow = JSON.parse(JSON.stringify(shape.build()));
    const { result, ms } = timed(() => validateFlow(flow));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result.valid).toBe(shape.valid);
    expect(result.issues.length).toBeLessThanOrEqual(101);
    if (result.issues.length === 101) expect(result.issues[100]).toMatchObject({ code: 'too_many_issues', path: '' });
  });

  it('un http con 8192 variantes de mayúsculas de Authorization da 8192 avisos literales completos y ordenados', () => {
    const name = 'authorization';
    const headers: Record<string, string> = {};
    for (let mask = 0; mask < 8192; mask++) {
      let variant = '';
      for (let bit = 0; bit < name.length; bit++) variant += (mask >> bit) & 1 ? name[bit]!.toUpperCase() : name[bit];
      headers[variant] = `literal-${mask}`;
    }
    const flow = base({ start: 'h', nodes: [END, http({ headers })] });
    const { result, ms } = timed(() => validateFlow(JSON.parse(JSON.stringify(flow))));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(8192);
    expect(new Set(result.warnings.map((warning) => warning.path)).size).toBe(8192);
    expect(result.warnings.every((warning) => warning.code === 'credential_header_literal')).toBe(true);
    expect(JSON.stringify(result.warnings)).not.toContain('literal-');
  });

  it('8000 nodos http con un marcador en el origen dan un aviso por nodo y ninguno se pierde', () => {
    const nodes = fill((i) => http({ url: 'https://{{s}}.example.com/x' }, { id: `h${i}`, next: i === 0 ? 'a' : `h${i - 1}` }), 4200);
    const flow = base({ start: `h${nodes.length - 1}`, variables: [{ name: 's', type: 'string' }], nodes: [END, ...nodes] });
    const { result, ms } = timed(() => validateFlow(JSON.parse(JSON.stringify(flow))));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(nodes.length);
    expect(nodes.length).toBeGreaterThan(100);
  });
});
