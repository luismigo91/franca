import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { DEPTH_ERROR } from '@/lib/editor/fields';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { connectOutput, deleteNode, NO_ID_ERROR, NOT_OBJECT_ERROR, replaceNodeJson, setTarget } from '@/lib/editor/node-ops';
import { displayPositions } from '@/lib/editor/layout';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const nodeOf = (flow: FlowDoc, id: string) => (flow.nodes as Record<string, unknown>[]).find((node) => node.id === id)!;

describe('deleteNode', () => {
  it('quita el nodo sin tocar los saltos: el validador los señala', () => {
    const flow = deleteNode(clone('captacion-leads'), 'aviso-error');
    expect(flow.nodes).toHaveLength(10);
    expect(nodeOf(flow, 'enviar-crm').onError).toBe('aviso-error');
    const verdict = validateFlow(flow);
    expect(verdict.issues.map((issue) => `${issue.nodeId}: ${issue.message}`)).toContain('enviar-crm: onError apunta a un nodo inexistente: aviso-error');
  });

  it('un nodo que no existe no cambia nada', () => {
    const flow = clone('hola');
    expect(deleteNode(flow, 'nada')).toBe(flow);
  });
});

describe('replaceNodeJson', () => {
  const replace = (flow: FlowDoc, id: string, text: string) => replaceNodeJson(flow, id, text);

  it('añade un título y el texto del flujo solo difiere en ese título', () => {
    const flow = clone('captacion-leads');
    const text = JSON.stringify({ ...nodeOf(flow, 'bienvenida'), title: 'Saludo' });
    const result = replace(flow, 'bienvenida', text);
    expect(result.ok && JSON.stringify(result.flow)).toBe(JSON.stringify(flow).replace('"type":"message","position":{"x":0,"y":0},', '"type":"message","position":{"x":0,"y":0},').replace('"next":"pedir-nombre"}', '"next":"pedir-nombre","title":"Saludo"}'));
  });

  it('JSON de un nodo roto: el error y nada cambia', () => {
    const flow = clone('captacion-leads');
    expect(replace(flow, 'bienvenida', '{"id":')).toEqual({ ok: false, error: NOT_OBJECT_ERROR });
    for (const text of ['5', '[]', 'null', '"x"']) expect(replace(flow, 'bienvenida', text)).toEqual({ ok: false, error: NOT_OBJECT_ERROR });
  });

  it('un nodo sin id de texto se rechaza', () => {
    expect(replace(clone('hola'), 'fin', '{"type":"end"}')).toEqual({ ok: false, error: NO_ID_ERROR });
    expect(replace(clone('hola'), 'fin', '{"id":5,"type":"end"}')).toEqual({ ok: false, error: NO_ID_ERROR });
  });

  it('un id distinto sigue las reglas de renombrar: actualiza las referencias', () => {
    const flow = clone('captacion-leads');
    const result = replace(flow, 'pedir-nombre', JSON.stringify({ ...nodeOf(flow, 'pedir-nombre'), id: 'nombre-completo' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nodeOf(result.flow, 'bienvenida').next).toBe('nombre-completo');
    expect(validateFlow(result.flow).valid).toBe(true);
  });

  it('un id repetido o fuera del patrón no cambia nada', () => {
    const flow = clone('captacion-leads');
    expect(replace(flow, 'pedir-nombre', JSON.stringify({ ...nodeOf(flow, 'pedir-nombre'), id: 'pedir-email' })).ok).toBe(false);
    expect(replace(flow, 'pedir-nombre', JSON.stringify({ ...nodeOf(flow, 'pedir-nombre'), id: 'Mal Id' })).ok).toBe(false);
  });

  it('cambia el type', () => {
    const result = replace(clone('hola'), 'fin', '{"id":"fin","type":"jump","target":"fin"}');
    expect(result.ok && nodeOf(result.flow, 'fin')).toEqual({ id: 'fin', type: 'jump', target: 'fin' });
  });

  it('1e400 se queda en null (ida y vuelta)', () => {
    const result = replace(clone('hola'), 'fin', '{"id":"fin","type":"end","x":1e400}');
    expect(result.ok && JSON.stringify(nodeOf(result.flow, 'fin'))).toBe('{"id":"fin","type":"end","x":null}');
  });

  it('un JSON de 100 000 niveles se rechaza con el error de profundidad, sin RangeError y con el flujo idéntico', () => {
    const flow = clone('captacion-leads');
    const before = JSON.stringify(flow);
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    expect(replace(flow, 'bienvenida', `{"id":"bienvenida","type":"end","x":${deep}}`)).toEqual({ ok: false, error: DEPTH_ERROR });
    expect(replace(flow, 'enviar-crm', `{"id":"enviar-crm","type":"http","request":{"method":"GET","url":"u","body":${deep}},"next":"ruta-segmento","onError":"aviso-error"}`)).toEqual({ ok: false, error: DEPTH_ERROR });
    expect(JSON.stringify(flow)).toBe(before);
  });
});

describe('connectOutput', () => {
  it('es setTarget sobre fixPositions: fija las posiciones y cambia el destino (el selector del inspector y el soltar)', () => {
    const flow = clone('faq-ia');
    const positions = displayPositions(flow);
    const result = connectOutput(flow, positions, 'crear-ticket', '/onError', 'fin-resuelto');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nodeOf(result.flow, 'crear-ticket').onError).toBe('fin-resuelto');
    for (const node of result.flow.nodes as Record<string, unknown>[]) {
      const { x, y } = node.position as { x: number; y: number };
      expect(Number.isInteger(x) && Number.isInteger(y), String(node.id)).toBe(true);
    }
    // El selector (sin posiciones) no es lo mismo: no fija nada.
    const plain = setTarget(flow, 'crear-ticket', '/onError', 'fin-resuelto');
    expect(plain.ok && Object.hasOwn(nodeOf(plain.flow, 'saludo'), 'position')).toBe(false);
  });

  it('«ninguno» también fija las posiciones', () => {
    const flow = clone('faq-ia');
    const result = connectOutput(flow, displayPositions(flow), 'saludo', '/next', null);
    expect(result.ok && Object.hasOwn(nodeOf(result.flow, 'saludo'), 'next')).toBe(false);
    expect(result.ok && Object.hasOwn(nodeOf(result.flow, 'asistente'), 'position')).toBe(true);
  });

  it('un nodo que no existe es un error', () => {
    expect(connectOutput(clone('hola'), displayPositions(clone('hola')), 'nada', '/next', 'fin').ok).toBe(false);
  });
});
