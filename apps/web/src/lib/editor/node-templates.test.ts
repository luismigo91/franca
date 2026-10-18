import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { addNode, emptyFlow, nextNodeId } from '@/lib/editor/node-templates';
import { NODE_TYPES } from '@/lib/editor/node-types';

const hola = () => structuredClone(FLOWS.hola) as FlowDoc;
const at = (x: number, y: number) => ({ x, y });
const FIN = new Map([['fin', at(0, 0)]]);

describe('emptyFlow', () => {
  it('Crear un flujo vacío: el texto exacto, con las claves en ese orden', () => {
    expect(JSON.stringify(emptyFlow('bienvenida-web', 'Bienvenida'))).toBe(
      '{"specVersion":"0.1","id":"bienvenida-web","name":"Bienvenida","start":"inicio","nodes":[{"id":"inicio","type":"end"}]}',
    );
    expect(validateFlow(emptyFlow('bienvenida-web', 'Bienvenida')).valid).toBe(true);
  });

  it('un identificador fuera del patrón o un nombre vacío no son válidos', () => {
    const bad = validateFlow(emptyFlow('Mi Flujo', 'Mío'));
    expect(bad.valid).toBe(false);
    expect(bad.issues.map((issue) => issue.path)).toContain('/id');
    expect(validateFlow(emptyFlow('x', '')).issues.map((issue) => issue.path)).toContain('/name');
  });
});

describe('addNode', () => {
  it('Añadir un mensaje: el JSON exacto como último nodo, con fin también con position', () => {
    const added = addNode(hola(), 'message', FIN, at(100, 50.4))!;
    expect(added.id).toBe('message-1');
    expect(JSON.stringify(added.flow)).toBe(
      '{"specVersion":"0.1","id":"hola","name":"Hola","start":"fin","nodes":[{"id":"fin","type":"end","position":{"x":0,"y":0}},{"id":"message-1","type":"message","position":{"x":100,"y":50},"content":[{"kind":"text","text":""}]}]}',
    );
  });

  it('las ocho plantillas llevan solo lo que dice la spec', () => {
    const expected: Record<string, unknown> = {
      message: { content: [{ kind: 'text', text: '' }] },
      input: { prompt: [{ kind: 'text', text: '' }], inputType: 'text' },
      condition: {},
      set: {},
      http: { request: { method: 'GET', url: '' } },
      llm: { provider: 'principal', goal: '' },
      jump: {},
      end: {},
    };
    expect(NODE_TYPES).toEqual(Object.keys(expected));
    for (const type of NODE_TYPES) {
      const node = (addNode(hola(), type, FIN, at(1, 2))!.flow.nodes as Record<string, unknown>[])[1]!;
      expect(node, type).toEqual({ id: `${type}-1`, type, position: at(1, 2), ...(expected[type] as object) });
    }
  });

  it('un tipo que no existe no añade nada', () => {
    expect(addNode(hola(), 'constructor', FIN, at(0, 0))).toBeNull();
    expect(addNode(hola(), '__proto__', FIN, at(0, 0))).toBeNull();
  });

  it('el id es <tipo>-<n> con el menor n libre', () => {
    const flow = hola();
    expect(nextNodeId(flow, 'message')).toBe('message-1');
    const one = addNode(flow, 'message', FIN, at(0, 0))!.flow;
    expect(nextNodeId(one, 'message')).toBe('message-2');
    const gap = structuredClone(one);
    (gap.nodes as Record<string, unknown>[]).push({ id: 'message-3', type: 'end' });
    expect(nextNodeId(gap, 'message')).toBe('message-2');
    (gap.nodes as Record<string, unknown>[]).splice(1, 1);
    expect(nextNodeId(gap, 'message')).toBe('message-1');
  });
});
