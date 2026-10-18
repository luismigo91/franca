import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { checkNodeId, ID_PATTERN_ERROR, ID_TAKEN_ERROR, isNodeId, renameNode } from '@/lib/editor/rename';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const rename = (flow: FlowDoc, from: string, to: string) => {
  const result = renameNode(flow, from, to);
  if (!result.ok) throw new Error(result.error);
  return result.flow;
};

/** Todos los valores de texto de un valor JSON. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

describe('renameNode', () => {
  it('Renombrar un nodo: no queda ningún valor pedir-nombre y el flujo es válido', () => {
    const renamed = rename(clone('captacion-leads'), 'pedir-nombre', 'pedir-nombre-completo');
    expect(strings(renamed)).not.toContain('pedir-nombre');
    expect((renamed.nodes as Record<string, unknown>[])[0]!.next).toBe('pedir-nombre-completo');
    expect((renamed.nodes as Record<string, unknown>[])[1]!.id).toBe('pedir-nombre-completo');
    expect(validateFlow(renamed).valid).toBe(true);
  });

  it('cambia start', () => {
    const renamed = rename(clone('captacion-leads'), 'bienvenida', 'inicio');
    expect(renamed.start).toBe('inicio');
    expect(validateFlow(renamed).valid).toBe(true);
  });

  it('cambia next, else, onError, onExhausted, target, rules[i].next y choices[i].next', () => {
    const captacion = clone('captacion-leads');
    for (const [from, to] of [
      ['marcar-pyme', 'pyme'], // choices[].next
      ['enviar-crm', 'crm'], // next de set
      ['aviso-error', 'error-crm'], // onError
      ['fin-empresa', 'fin-grande'], // rules[0].next
      ['fin-pyme', 'fin-chica'], // else
    ] as const) {
      const renamed = rename(captacion, from, to);
      expect(strings(renamed), from).not.toContain(from);
      expect(strings(renamed), from).toContain(to);
      expect(validateFlow(renamed).valid, from).toBe(true);
    }
    const faq = clone('faq-ia');
    const renamed = rename(faq, 'pedir-email', 'email');
    expect(strings(renamed)).not.toContain('pedir-email');
    expect(validateFlow(renamed).valid).toBe(true);
    const jump = { specVersion: '0.1', id: 'j', name: 'J', start: 'a', nodes: [{ id: 'a', type: 'jump', target: 'b' }, { id: 'b', type: 'end' }] } as FlowDoc;
    expect(JSON.stringify(rename(jump, 'b', 'c'))).toBe('{"specVersion":"0.1","id":"j","name":"J","start":"a","nodes":[{"id":"a","type":"jump","target":"c"},{"id":"c","type":"end"}]}');
  });

  it('el autosalto de un llm también cambia', () => {
    const flow = clone('faq-ia');
    (flow.nodes as Record<string, unknown>[])[1]!.next = 'asistente';
    const renamed = rename(flow, 'asistente', 'ia');
    expect(((renamed.nodes as Record<string, unknown>[])[1]!).next).toBe('ia');
    expect(strings(renamed)).not.toContain('asistente');
  });

  it('un patrón inválido o un id repetido no cambian nada', () => {
    const flow = clone('captacion-leads');
    expect(renameNode(flow, 'pedir-nombre', 'Mal Id')).toEqual({ ok: false, error: ID_PATTERN_ERROR });
    expect(renameNode(flow, 'pedir-nombre', '')).toEqual({ ok: false, error: ID_PATTERN_ERROR });
    expect(renameNode(flow, 'pedir-nombre', 'pedir-email')).toEqual({ ok: false, error: ID_TAKEN_ERROR });
    expect(renameNode(flow, 'pedir-nombre', 'pedir-nombre')).toEqual({ ok: true, flow });
    expect(renameNode(flow, 'no-existe', 'x').ok).toBe(false);
  });

  it('no toca los textos con {{…}}', () => {
    const flow = clone('captacion-leads');
    const renamed = rename(flow, 'bienvenida', 'nombre');
    expect(JSON.stringify(renamed)).toContain('"Encantado, {{nombre}}. ');
    expect(JSON.stringify(renamed)).toContain('"name":"{{nombre}}"');
  });

  it('un nodo mal formado no lanza', () => {
    const flow = { nodes: [{ id: 'a', type: 'condition' }, { id: 'b', type: 'input', choices: 'x', next: 'a' }, { id: 'c', type: 'end' }], start: 'a' } as FlowDoc;
    expect(rename(flow, 'a', 'z').nodes).toEqual([{ id: 'z', type: 'condition' }, { id: 'b', type: 'input', choices: 'x', next: 'z' }, { id: 'c', type: 'end' }]);
  });
});

describe('checkNodeId e isNodeId', () => {
  it('patrón de la spec', () => {
    expect(isNodeId('abc-1_x')).toBe(true);
    expect(isNodeId('Abc')).toBe(false);
    expect(isNodeId('1a')).toBe(false);
    expect(isNodeId(5)).toBe(false);
    expect(isNodeId('a'.repeat(65))).toBe(false);
    expect(checkNodeId(clone('hola'), 'fin', 'fin')).toBeNull();
  });
});
