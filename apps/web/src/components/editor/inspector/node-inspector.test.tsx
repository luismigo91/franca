import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlowPanel } from '@/components/editor/flow-panel';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { NodeInspector } from '@/components/editor/inspector/node-inspector';
import { problemsOf } from '@/lib/editor/issues-view';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { displayPositions } from '@/lib/editor/layout';
import { validateDraft } from '@/lib/editor/validate-draft';
import { FLOWS } from '../../../../tests/helpers/engine-events';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const NOTE = 'Este valor no tiene la forma que edita el formulario: corrígelo como JSON.';

function context(flow: FlowDoc, index: number): FieldContext {
  const nodes = flow.nodes as { id: unknown }[];
  return {
    flow,
    nodeId: typeof nodes[index]?.id === 'string' ? (nodes[index]!.id as string) : null,
    nodeBase: `/nodes/${index}`,
    positions: displayPositions(flow),
    nodeIds: nodes.flatMap((node) => (typeof node.id === 'string' ? [node.id] : [])),
    problems: problemsOf(validateDraft(flow)),
    edit: () => ({ ok: true, flow }),
    rename: () => ({ ok: true, flow }),
    focusInspector: () => undefined,
  };
}

const inspect = (flow: FlowDoc, id: string): string => {
  const index = (flow.nodes as { id: string }[]).findIndex((node) => node.id === id);
  return renderToStaticMarkup(<NodeInspector ctx={context(flow, index)} index={index} onEditJson={() => undefined} onDelete={() => undefined} />);
};

const setIn = (flow: FlowDoc, id: string, change: (node: Record<string, unknown>) => void): FlowDoc => {
  const copy = structuredClone(flow);
  change((copy.nodes as Record<string, unknown>[]).find((node) => node.id === id)!);
  return copy;
};

describe('NodeInspector: los ocho tipos', () => {
  it('muestra los campos de cada tipo con los valores del flujo', () => {
    const captacion = clone('captacion-leads');
    const faq = clone('faq-ia');
    const http = inspect(captacion, 'enviar-crm');
    expect(http).toContain('Llamada HTTP');
    expect(http).toContain('<option value="POST" selected="">POST</option>');
    expect(http).toContain('value="https://crm.example.com/api/leads"');
    expect(http).toContain('Cabecera Authorization');
    expect(http).toContain('Nombre del secreto, en mayúsculas');
    expect(http).toContain('value="CRM_TOKEN"');
    const llm = inspect(faq, 'asistente');
    expect(llm).toContain('value="principal"');
    expect(llm).toContain('Datos que recoge');
    expect(llm).toContain('Si se agota (onExhausted)');
    const choice = inspect(captacion, 'pedir-tamano');
    for (const id of ['pequena', 'mediana', 'grande']) expect(choice).toContain(`value="${id}"`);
    expect(choice).toContain('Quitar opción 3');
    expect(inspect(captacion, 'ruta-segmento')).toContain('regla 1');
    expect(inspect(captacion, 'marcar-pyme')).toContain('Asignaciones');
    expect(inspect(captacion, 'bienvenida')).toContain('Mensaje');
    expect(inspect(captacion, 'fin-empresa')).toContain('Resultado (outcome)');
    const jump = setIn(captacion, 'bienvenida', (node) => {
      node.type = 'jump';
      delete node.content;
      delete node.next;
      node.id = 'bienvenida';
    });
    expect(inspect(jump, 'bienvenida')).toContain('Destino (target)');
  });

  it('el id, el tipo y la posición se muestran; type y position de solo lectura', () => {
    const html = inspect(clone('captacion-leads'), 'bienvenida');
    expect(html).toContain('value="bienvenida"');
    expect(html).toContain('>0, 0<');
    expect(inspect(clone('faq-ia'), 'saludo')).toContain('>automática<');
    expect(html).not.toMatch(/<input[^>]*aria-label="Tipo"/);
  });

  it('choices y multiple solo con inputType choice, o si ya existen', () => {
    expect(inspect(clone('captacion-leads'), 'pedir-nombre')).not.toContain('Opciones');
    expect(inspect(clone('captacion-leads'), 'pedir-nombre')).not.toContain('Selección múltiple');
    expect(inspect(clone('captacion-leads'), 'pedir-tamano')).toContain('Selección múltiple');
  });

  it('un tipo de nodo desconocido muestra solo id y tipo y «Usa «Editar como JSON» para este nodo»', () => {
    for (const type of ['desconocido', 'constructor', 'toString', '__proto__']) {
      const flow = setIn(clone('captacion-leads'), 'bienvenida', (node) => (node.type = type));
      const html = inspect(flow, 'bienvenida');
      expect(html, type).toContain('Usa «Editar como JSON» para este nodo.');
      expect(html).toContain(`Nodo bienvenida · ${type}`);
      expect(html).not.toContain('Contenido');
    }
  });
});

describe('NodeInspector: valores de tipo inesperado (skipFieldFit)', () => {
  it('un http con request null pasa el campo a JSON libre con su nota', () => {
    const html = inspect(setIn(clone('captacion-leads'), 'enviar-crm', (node) => (node.request = null)), 'enviar-crm');
    expect(html).toContain(NOTE);
    expect(html).toContain('Petición (JSON)');
    expect(html).not.toContain('[object Object]');
  });

  it('un http con headers null, y una cabecera {"x": 1}', () => {
    const nullHeaders = inspect(setIn(clone('captacion-leads'), 'enviar-crm', (node) => ((node.request as Record<string, unknown>).headers = null)), 'enviar-crm');
    expect(nullHeaders).toContain(NOTE);
    expect(nullHeaders).toContain('Cabeceras (JSON)');
    const badHeader = inspect(setIn(clone('captacion-leads'), 'enviar-crm', (node) => ((node.request as Record<string, unknown>).headers = { x: 1 })), 'enviar-crm');
    expect(badHeader).toContain(NOTE);
    expect(badHeader).not.toContain('Cabecera x');
    expect(badHeader).not.toContain('[object Object]');
  });

  it('una condición con when: 5 (y null y "x") va a JSON libre', () => {
    for (const when of [5, null, 'x']) {
      const html = inspect(setIn(clone('captacion-leads'), 'ruta-segmento', (node) => ((node.rules as Record<string, unknown>[])[0]!.when = when)), 'ruta-segmento');
      expect(html, JSON.stringify(when)).toContain(NOTE);
      expect(html).not.toContain('[object Object]');
    }
  });

  it('una lista con elementos que no son objetos pasa entera a JSON libre (rules: [null], choices: [null])', () => {
    const rules = inspect(setIn(clone('captacion-leads'), 'ruta-segmento', (node) => (node.rules = [null])), 'ruta-segmento');
    expect(rules).toContain(NOTE);
    expect(rules).toContain('Reglas (JSON)');
    const choices = inspect(setIn(clone('captacion-leads'), 'pedir-tamano', (node) => (node.choices = [null])), 'pedir-tamano');
    expect(choices).toContain(NOTE);
    expect(choices).toContain('Opciones (JSON)');
  });

  it('un nodo con type "constructor" no lanza y muestra el aviso de tipo desconocido', () => {
    const html = inspect(setIn(clone('captacion-leads'), 'enviar-crm', (node) => (node.type = 'constructor')), 'enviar-crm');
    expect(html).toContain('Usa «Editar como JSON» para este nodo.');
  });

  it('ninguna propiedad sustituida por un valor de otro tipo pinta [object Object] ni lanza', () => {
    const base = clone('captacion-leads');
    for (const id of ['bienvenida', 'pedir-email', 'pedir-tamano', 'marcar-pyme', 'enviar-crm', 'ruta-segmento', 'fin-empresa']) {
      const node = (base.nodes as Record<string, unknown>[]).find((candidate) => candidate.id === id)!;
      for (const key of Object.keys(node).filter((name) => name !== 'id')) {
        for (const bad of [null, 5, 'x', [], {}]) {
          const html = inspect(setIn(base, id, (target) => (target[key] = bad)), id);
          expect(html, `${id}.${key}=${JSON.stringify(bad)}`).not.toContain('[object Object]');
        }
      }
    }
  });
});

describe('FlowPanel', () => {
  it('muestra nombre, descripción, locale, settings, start y variables; id y specVersion solo se muestran', () => {
    const flow = clone('captacion-leads');
    const html = renderToStaticMarkup(<FlowPanel ctx={{ ...context(flow, 0), nodeId: null, nodeBase: '' }} />);
    expect(html).toContain('value="Captación de leads"');
    expect(html).toContain('Nodo de inicio (start)');
    expect(html).toContain('Nombre de la variable');
    expect(html).toContain('Dato personal');
    expect(html).toContain('>0.1<');
    expect(html).toContain('>captacion-leads<');
    expect(html).toContain('Ajustes');
    expect(html).toContain('id="inspector-title" tabindex="-1"');
  });

  it('settings: 5 o variables: [null] pasan a JSON libre', () => {
    const flow = clone('captacion-leads');
    flow.settings = 5;
    flow.variables = [null];
    const html = renderToStaticMarkup(<FlowPanel ctx={{ ...context(flow, 0), nodeId: null, nodeBase: '' }} />);
    expect(html).toContain('Ajustes (JSON)');
    expect(html).toContain('Variables (JSON)');
    expect(html).not.toContain('[object Object]');
  });
});
