import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContentField } from '@/components/editor/inspector/content-field';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { fieldsOfType } from '@/lib/editor/node-fields';
import { FLOWS } from '../../../../tests/helpers/engine-events';

const descriptor = fieldsOfType('message')!.find((field) => field.key === 'content')!;

function render(flow: FlowDoc, nodeIndex: number): string {
  const ctx: FieldContext = { flow, nodeId: 'm', nodeBase: `/nodes/${nodeIndex}`, positions: new Map(), nodeIds: [], problems: [], edit: () => ({ ok: true, flow }), rename: () => ({ ok: true, flow }), focusInspector: () => undefined };
  const value = ((flow.nodes as Record<string, unknown>[])[nodeIndex] as { content: unknown }).content;
  return renderToStaticMarkup(<ContentField descriptor={descriptor} pointer={`/nodes/${nodeIndex}/content`} value={value} ctx={ctx} />);
}

const medios = () => structuredClone(FLOWS.medios) as FlowDoc;

describe('ContentField', () => {
  it('las URLs y los textos del flujo salen solo en un value, sin img, video, audio, iframe, embed ni enlaces (loadFlowUrls)', () => {
    const html = render(medios(), 0);
    expect(html).toContain('value="https://example.com/logo.png"');
    expect(html).toContain('&lt;b&gt;Hola&lt;/b&gt;');
    for (const tag of ['<img', '<video', '<audio', '<iframe', '<embed', '<object', '<source', '<picture', '<a ', '<a>']) expect(html, tag).not.toContain(tag);
    expect(html).not.toMatch(/src="|href="/);
    for (const url of ['https://example.com/audio.mp3', 'https://example.com/widget', 'javascript:alert(1)', 'data:video/mp4;base64,AAAA']) expect(html).toContain(`value="${url}"`);
  });

  it('un elemento con text que no es texto va a JSON libre con su nota, sin [object Object]', () => {
    const flow = medios();
    ((flow.nodes as { content: unknown[] }[])[0]!.content as unknown[])[0] = { kind: 'text', text: {} };
    const html = render(flow, 0);
    expect(html).toContain('Este valor no tiene la forma que edita el formulario: corrígelo como JSON.');
    expect(html).not.toContain('[object Object]');
    expect(html).toContain('<textarea');
  });

  it('url o alt que no son texto también van a JSON libre', () => {
    for (const item of [{ kind: 'image', url: 5 }, { kind: 'image', url: 'u', alt: {} }, { kind: 'text' }, { kind: 5, text: 'a' }, null]) {
      const flow = medios();
      (flow.nodes as { content: unknown[] }[])[0]!.content = [item];
      const html = render(flow, 0);
      expect(html, JSON.stringify(item)).toContain('Este valor no tiene la forma que edita el formulario');
      expect(html).not.toContain('[object Object]');
    }
  });

  it('cada elemento tiene su clase, su texto o su URL, y «Quitar»', () => {
    const html = render(medios(), 0);
    expect(html).toContain('Quitar contenido 1');
    expect(html).toContain('Añadir elemento a contenido');
    expect(html).toContain('URL (solo texto, no se carga)');
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="url"');
  });
});
