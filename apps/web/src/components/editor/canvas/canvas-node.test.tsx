import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CanvasNodeView, type DropState } from '@/components/editor/canvas/canvas-node';
import { canvasModel, type CanvasNode } from '@/lib/editor/canvas-model';
import { NODE_WIDTH, nodeSize } from '@/lib/editor/canvas-geometry';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { displayPositions } from '@/lib/editor/layout';
import { FLOWS } from '../../../../tests/helpers/engine-events';

const noop = () => undefined;

/** Pinta el primer nodo (o el de `id`) de un flujo con el mismo marcado que el lienzo. */
function render(flow: FlowDoc, options: { id?: string; selected?: boolean; problems?: { issues: number; warnings: number }; truncated?: boolean; dropState?: DropState | null } = {}): string {
  const model = canvasModel(flow, displayPositions(flow));
  const node = model.nodes.find((candidate) => candidate.id === (options.id ?? model.nodes[0]!.id)) as CanvasNode;
  return renderToStaticMarkup(
    <CanvasNodeView
      node={node}
      selected={options.selected ?? false}
      problems={options.problems}
      truncated={options.truncated ?? false}
      origin={model.bounds}
      offset={{ x: 0, y: 0 }}
      dropState={options.dropState ?? null}
      onNodePointerDown={noop}
      onOutputPointerDown={noop}
      onNodeKeyDown={noop}
    />,
  );
}

const flowWith = (node: Record<string, unknown>): FlowDoc => ({ specVersion: '0.1', id: 'x', name: 'X', start: 'a', nodes: [{ id: 'a', type: 'end', ...node }] });
const captacion = () => structuredClone(FLOWS['captacion-leads']) as FlowDoc;

describe('CanvasNodeView', () => {
  it('tiene el nombre accesible «<id>, <tipo>[, inicio], N problemas | sin problemas»', () => {
    expect(render(captacion(), { id: 'bienvenida' })).toContain('aria-label="bienvenida, Mensaje, inicio, sin problemas"');
    expect(render(captacion(), { id: 'pedir-nombre', problems: { issues: 2, warnings: 0 } })).toContain('aria-label="pedir-nombre, Pregunta, 2 problemas"');
    expect(render(captacion(), { id: 'enviar-crm', problems: { issues: 1, warnings: 1 } })).toContain('aria-label="enviar-crm, Llamada HTTP, 1 problema y 1 aviso"');
  });

  it('es enfocable, un botón, y marca la selección; el nodo de inicio lleva «Inicio» y los problemas, texto', () => {
    const html = render(captacion(), { id: 'bienvenida', selected: true, problems: { issues: 3, warnings: 0 } });
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('>Inicio<');
    expect(html).toContain('>3 problemas<');
    expect(render(captacion(), { id: 'pedir-email' })).not.toContain('>Inicio<');
  });

  it('con la lista de problemas recortada, un nodo sin problemas listados no dice «sin problemas» a secas', () => {
    expect(render(captacion(), { id: 'pedir-email', truncated: true })).toContain('aria-label="pedir-email, Pregunta, sin problemas conocidos"');
    expect(render(captacion(), { id: 'pedir-email' })).toContain('pedir-email, Pregunta, sin problemas"');
  });

  it('las salidas llevan su nombre, su puntero y data-output, y no reciben el foco', () => {
    const html = render(captacion(), { id: 'pedir-tamano' });
    for (const key of ['choices[pequena].next', 'choices[mediana].next', 'choices[grande].next']) expect(html).toContain(`data-output="${key}"`);
    expect(html).toContain('data-pointer="/choices/2/next"');
    const outputs = html.match(/<span[^>]*data-output=[^>]*>/g) ?? [];
    expect(outputs).toHaveLength(3);
    for (const output of outputs) {
      expect(output).toContain('aria-hidden="true"');
      expect(output).not.toContain('tabindex');
    }
    expect(html).not.toContain('tabindex');
  });

  it('la caja mide lo que dice nodeSize y recorta lo que no cabe, también con un title de 120 caracteres', () => {
    const flow = captacion();
    const html = render(flow, { id: 'pedir-tamano' });
    const size = nodeSize((flow.nodes as unknown[])[3]);
    expect(size).toEqual({ width: NODE_WIDTH, height: 64 + 24 * 3 });
    expect(html).toContain(`width:${size.width}px;height:${size.height}px`);
    expect(html).toContain('overflow-hidden');
    const long = render(flowWith({ title: 'T'.repeat(120) }));
    expect(long).toContain('width:208px;height:64px');
    expect(long).toContain('overflow-hidden');
    expect(long).toContain('class="block truncate text-[11px]"');
  });

  it('un title o un type que no son texto se pintan con asText y no lanzan (renderRawTitle)', () => {
    for (const [title, shown] of [[{}, '{}'], [[], '[]'], [5, '5'], [null, 'null'], [{ es: 'Saludo' }, '{&quot;es&quot;:&quot;Saludo&quot;}']] as const) {
      const html = render(flowWith({ title }));
      expect(html, JSON.stringify(title)).toContain(`>${shown}<`);
      expect(html).not.toContain('[object Object]');
    }
    const typed = render(flowWith({ type: {} }));
    expect(typed).toContain('>{}<');
    expect(typed).not.toContain('[object Object]');
    for (const type of ['constructor', '__proto__', 'toString']) expect(render(flowWith({ type }))).toContain(`>${type}<`);
  });

  it('el id de un nodo es texto: constructor no choca con ninguna tabla', () => {
    expect(render({ specVersion: '0.1', id: 'x', name: 'X', start: 'constructor', nodes: [{ id: 'constructor', type: 'end' }] })).toContain('data-node-id="constructor"');
  });

  it('los textos se pintan como texto plano: <b> sale escapado', () => {
    const html = render(flowWith({ title: '<b>Hola</b>' }));
    expect(html).toContain('&lt;b&gt;Hola&lt;/b&gt;');
    expect(html).not.toContain('<b>Hola');
  });

  it('mientras se arrastra una salida, cada nodo dice con texto si se puede soltar (Soltar aquí / No se puede soltar aquí)', () => {
    const allowed = render(captacion(), { id: 'pedir-email', dropState: 'allowed' });
    expect(allowed).toContain('data-drop="allowed"');
    expect(allowed).toContain('Soltar aquí');
    expect(allowed).toContain('border-dashed');
    const denied = render(captacion(), { id: 'pedir-email', dropState: 'denied' });
    expect(denied).toContain('data-drop="denied"');
    expect(denied).toContain('No se puede soltar aquí');
    expect(denied).toContain('opacity-50');
    expect(render(captacion(), { id: 'pedir-email' })).not.toContain('data-drop');
  });
});
