import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CanvasEdges } from '@/components/editor/canvas/canvas-edges';
import { FlowPanel } from '@/components/editor/flow-panel';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { NodeInspector } from '@/components/editor/inspector/node-inspector';
import { canvasModel } from '@/lib/editor/canvas-model';
import { addHeader, removeHeader, renameHeader, writeHeader } from '@/lib/editor/fields';
import { flowText } from '@/lib/editor/flow-text';
import { problemsOf } from '@/lib/editor/issues-view';
import { getIn, parsePointer, pointerOf, type FlowDoc } from '@/lib/editor/json-edit';
import { displayPositions } from '@/lib/editor/layout';
import { validateDraft } from '@/lib/editor/validate-draft';

// QA adversarial del editor (web-editor, 2026-10-18): lo que `malformed-flows.test.ts` (D25) no recorre. Valores raros a
// nivel de flujo (no de nodo), los nombres de cabecera que son punteros RFC 6901 traicioneros y la geometría con números
// finitos pero enormes. Los `it.fails` documentan defectos conocidos: pasan mientras el defecto exista y fallan, para que
// alguien los convierta en `it`, cuando se corrija.

const T = (text: string) => [{ kind: 'text', text }];

function context(flow: FlowDoc, index: number): FieldContext {
  const nodes = Array.isArray(flow.nodes) ? (flow.nodes as { id?: unknown }[]) : [];
  const id = nodes[index]?.id;
  return {
    flow,
    nodeId: typeof id === 'string' ? id : null,
    nodeBase: `/nodes/${index}`,
    positions: displayPositions(flow),
    nodeIds: nodes.flatMap((node) => (typeof node.id === 'string' ? [node.id] : [])),
    problems: problemsOf(validateDraft(flow)),
    edit: () => ({ ok: true, flow }),
    rename: () => ({ ok: true, flow }),
  };
}

const HOSTILE_ROOT_VALUES: [string, unknown][] = [
  ['null', null],
  ['5', 5],
  ['texto', 'x'],
  ['lista vacía', []],
  ['objeto vacío', {}],
  ['lista de nulos y objetos', [null, {}, { name: {}, type: [], scope: 5, pii: 'x', default: { a: 1 }, description: {} }]],
  ['objeto con __proto__', JSON.parse('{"__proto__":{"a":1},"constructor":5}')],
];

describe('panel del flujo: cada propiedad de primer nivel con un valor de otro tipo', () => {
  for (const key of ['name', 'description', 'locale', 'settings', 'variables', 'start']) {
    it.each(HOSTILE_ROOT_VALUES)(`${key} = %s no lanza y no pinta [object Object], NaN ni undefined`, (_label, value) => {
      const flow: FlowDoc = { specVersion: '0.1', id: 'x', name: 'N', start: 'a', nodes: [{ id: 'a', type: 'end' }], [key]: value };
      const html = renderToStaticMarkup(<FlowPanel ctx={context(flow, -1)} />);
      expect(html).toContain('Propiedades del flujo');
      expect(html).not.toContain('[object Object]');
      expect(html).not.toContain('NaN');
      expect(html).not.toMatch(/>undefined</);
      expect(html).not.toMatch(/value="undefined"/);
    });
  }

  it('variables con elementos que no son objetos caen al editor de JSON con su nota y sin inventar filas', () => {
    const flow: FlowDoc = { specVersion: '0.1', id: 'x', name: 'N', start: 'a', nodes: [{ id: 'a', type: 'end' }], variables: [null, 5, 'x', [], { name: 'ok', type: 'string' }] };
    const html = renderToStaticMarkup(<FlowPanel ctx={context(flow, -1)} />);
    expect(html).toContain('Este valor no tiene la forma que edita el formulario: corrígelo como JSON.');
    expect(html).toContain('&quot;name&quot;: &quot;ok&quot;');
    expect(html).not.toContain('[object Object]');
  });
});

describe('inspector de un nodo con type de prototipo o sin tipo conocido', () => {
  it.each([['constructor'], ['__proto__'], ['toString'], ['hasOwnProperty'], [null], [5], [{}]])('type = %j', (type) => {
    const flow: FlowDoc = { specVersion: '0.1', id: 'x', name: 'N', start: 'a', nodes: [{ id: 'a', type, next: 'a' }] };
    const html = renderToStaticMarkup(<NodeInspector ctx={context(flow, 0)} index={0} onEditJson={() => undefined} onDelete={() => undefined} />);
    expect(html).not.toContain('[object Object]');
    expect(html).not.toContain('function Object');
  });
});

describe('cabeceras: nombres que son punteros RFC 6901 traicioneros', () => {
  const HEADERS = '/nodes/0/request/headers';
  const flow = (): FlowDoc => ({
    specVersion: '0.1',
    id: 'x',
    name: 'N',
    start: 'h',
    nodes: [{ id: 'h', type: 'http', request: { method: 'GET', url: 'https://example.com', headers: { 'X-One': 'a' } }, next: 'h' }],
  });
  const NAMES = ['a/b', 'x~y', '~0', '~1', '~', '/', '-', '10', '0', '01', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'ñ', 'a b'];

  const headersOf = (draft: FlowDoc): Record<string, unknown> => getIn(draft, HEADERS) as Record<string, unknown>;

  it.each(NAMES)('añadir, editar, renombrar y quitar %j deja las claves exactas, sin contaminar el prototipo', (name) => {
    const added = addHeader(HEADERS, name, 'text', 'v1')(flow(), null);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const headers = headersOf(added.flow);
    expect(Object.keys(headers).sort()).toEqual(['X-One', name].sort());
    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype);
    expect(Object.hasOwn(headers, name)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(headers, name)?.value).toBe('v1');
    expect(getIn(added.flow, `${HEADERS}${pointerOf([name])}`)).toBe('v1');
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(Object.getPrototypeOf(added.flow)).toBe(Object.prototype);

    const edited = writeHeader(HEADERS, name, 'secret', 'MI_SECRETO')(added.flow, null);
    expect(edited.ok && Object.getOwnPropertyDescriptor(headersOf(edited.flow), name)?.value).toEqual({ secret: 'MI_SECRETO' });
    // Las claves que son un entero JS salen primero en cualquier objeto: el orden es el de `JSON.stringify`, no el de inserción.
    expect(Object.keys(headersOf((edited as { flow: FlowDoc }).flow)).sort()).toEqual(['X-One', name].sort());

    const renamed = renameHeader(HEADERS, name, 'X-Two')(added.flow, null);
    // Renombra en su sitio: la clave nueva ocupa el lugar de la vieja (un entero JS va primero, así que ahí queda delante).
    expect(renamed.ok && Object.keys(headersOf(renamed.flow))).toEqual(/^(0|[1-9][0-9]*)$/.test(name) ? ['X-Two', 'X-One'] : ['X-One', 'X-Two']);
    expect(renamed.ok && Object.hasOwn(headersOf(renamed.flow), name)).toBe(false);

    const removed = removeHeader(HEADERS, name)(added.flow, null);
    expect(removed.ok && flowText(removed.flow)).toBe(flowText(flow()));
  });

  it.each(NAMES)('renombrar X-One a %j conserva el valor y el orden, y no lo reinterpreta', (name) => {
    const renamed = renameHeader(HEADERS, 'X-One', name)(flow(), null);
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const headers = headersOf(renamed.flow);
    expect(Object.keys(headers)).toEqual([name]);
    expect(Object.getOwnPropertyDescriptor(headers, name)?.value).toBe('a');
    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype);
  });

  it('dos nombres cuya forma escapada se parece no se confunden entre sí', () => {
    let draft = flow();
    for (const name of ['a/b', 'a~1b', 'a~01b']) {
      const added = addHeader(HEADERS, name, 'text', name)(draft, null);
      expect(added.ok, name).toBe(true);
      if (added.ok) draft = added.flow;
    }
    const headers = headersOf(draft);
    expect(Object.keys(headers)).toEqual(['X-One', 'a/b', 'a~1b', 'a~01b']);
    for (const name of ['a/b', 'a~1b', 'a~01b']) expect(getIn(draft, `${HEADERS}${pointerOf([name])}`)).toBe(name);
  });

  it('pointerOf y parsePointer son inversos para segmentos con ~, / y vacíos', () => {
    const pool = ['', '~', '/', '~0', '~1', '~~', '//', '-', '0', '10', '__proto__', 'constructor', 'a/b', 'x~y', '~/~'];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 2000; i++) {
      const length = 1 + (next() % 4);
      const segments = Array.from({ length }, () => pool[next() % pool.length]!);
      expect(parsePointer(pointerOf(segments)), JSON.stringify(segments)).toEqual(segments);
    }
  });

  it('getIn no sale por el prototipo ni por índices raros de una lista', () => {
    const doc = { list: ['a', 'b'], obj: { '10': 'x' } };
    for (const pointer of ['/list/-', '/list/01', '/list/-1', '/list/1e0', '/list/length', '/list/__proto__', '/obj/constructor', '/obj/__proto__/x', '/__proto__', '/constructor/name']) {
      expect(getIn(doc, pointer), pointer).toBeUndefined();
    }
    expect(getIn(doc, '/list/1')).toBe('b');
    expect(getIn(doc, '/obj/10')).toBe('x');
  });
});

describe('lienzo con posiciones finitas pero enormes', () => {
  const flowAt = (x: number, y: number): FlowDoc => ({
    specVersion: '0.1',
    id: 'x',
    name: 'N',
    start: 'a',
    nodes: [
      { id: 'a', type: 'message', content: T('hola'), next: 'fin', position: { x, y } },
      { id: 'fin', type: 'end', position: { x: 0, y: 0 } },
    ],
  });
  const edgesSvg = (flow: FlowDoc): string => {
    const model = canvasModel(flow, displayPositions(flow));
    return renderToStaticMarkup(<CanvasEdges edges={model.edges} bounds={model.bounds} selectedId={null} provisional={null} />);
  };
  const EXPONENT = /\d[eE][+-]?\d/;

  it('control: con posiciones normales el SVG no lleva notación exponencial', () => {
    const svg = edgesSvg(flowAt(1_000_000, -1_000_000));
    expect(svg).toContain('viewBox="');
    expect(svg).not.toMatch(EXPONENT);
  });

  // QA-1: la API acepta `position` con 1e308 (es un número finito) y el SVG recibe `viewBox="… 1e+308 …"` y `d="M 1e+308 …"`, que
  // el navegador rechaza con `console.error` («<svg> attribute viewBox: Expected number»): la consola deja de estar limpia y la
  // conexión no se dibuja. Reproducción: POST /flows con `position: {x: 1e308, y: -1e308}` y abrir /flujos/<id>.
  it.fails.each([
    [1e308, -1e308],
    [1e21, 0],
    [0, -1e21],
  ])('QA-1 (defecto conocido): posición (%s, %s) no debe dar números con exponente al SVG', (x, y) => {
    expect(edgesSvg(flowAt(x, y))).not.toMatch(EXPONENT);
  });
});
