import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { canDropOn, resolveDrop } from '@/lib/editor/drop';
import type { FlowDoc } from '@/lib/editor/json-edit';
import { displayPositions } from '@/lib/editor/layout';
import { connectOutput, setTarget } from '@/lib/editor/node-ops';
import { addNode } from '@/lib/editor/node-templates';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const nodeOf = (flow: FlowDoc, id: string) => (flow.nodes as Record<string, unknown>[]).find((node) => node.id === id)!;
const drop = (flow: FlowDoc, sourceId: string, outputPointer: string, targetId: string | null, cancelled = false) =>
  resolveDrop({ flow, positions: displayPositions(flow), sourceId, outputPointer, targetId, cancelled });

/** El flujo sin sus posiciones, para comparar con setTarget. */
function withoutPositions(flow: FlowDoc): unknown {
  return { ...flow, nodes: (flow.nodes as Record<string, unknown>[]).map((node) => Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'position'))) };
}

describe('resolveDrop', () => {
  it('destino válido: conecta, y es el mismo JSON que setTarget salvo las position', () => {
    const flow = clone('captacion-leads');
    const result = drop(flow, 'pedir-nombre', '/next', 'pedir-tamano');
    expect(result.kind).toBe('connect');
    if (result.kind !== 'connect') return;
    expect(nodeOf(result.flow, 'pedir-nombre').next).toBe('pedir-tamano');
    const plain = setTarget(flow, 'pedir-nombre', '/next', 'pedir-tamano');
    expect(plain.ok && JSON.stringify(withoutPositions(result.flow))).toBe(plain.ok && JSON.stringify(withoutPositions(plain.flow)));
    const viaInspector = connectOutput(flow, displayPositions(flow), 'pedir-nombre', '/next', 'pedir-tamano');
    expect(viaInspector.ok && JSON.stringify(viaInspector.flow)).toBe(JSON.stringify(result.flow));
  });

  it('sustituye la conexión que ya tenía, en su sitio', () => {
    const flow = clone('captacion-leads');
    const result = drop(flow, 'ruta-segmento', '/else', 'fin-empresa');
    expect(result.kind === 'connect' && nodeOf(result.flow, 'ruta-segmento').else).toBe('fin-empresa');
    expect(result.kind === 'connect' && Object.keys(nodeOf(result.flow, 'ruta-segmento')).slice(0, 4)).toEqual(['id', 'type', 'rules', 'else']);
  });

  it('cada clase de salida: opción, regla, onExhausted y target de un jump añadido', () => {
    const captacion = clone('captacion-leads');
    const choice = drop(captacion, 'pedir-tamano', '/choices/0/next', 'marcar-empresa');
    expect(choice.kind === 'connect' && (nodeOf(choice.flow, 'pedir-tamano').choices as { next: string }[])[0]!.next).toBe('marcar-empresa');
    const rule = drop(captacion, 'ruta-segmento', '/rules/0/next', 'fin-pyme');
    expect(rule.kind === 'connect' && (nodeOf(rule.flow, 'ruta-segmento').rules as { next: string }[])[0]!.next).toBe('fin-pyme');
    const exhausted = drop(clone('faq-ia'), 'asistente', '/onExhausted', 'fin-resuelto');
    expect(exhausted.kind === 'connect' && nodeOf(exhausted.flow, 'asistente').onExhausted).toBe('fin-resuelto');
    const added = addNode(captacion, 'jump', displayPositions(captacion), { x: 0, y: 500 })!;
    const jump = drop(added.flow, added.id, '/target', 'bienvenida');
    expect(jump.kind === 'connect' && nodeOf(jump.flow, added.id).target).toBe('bienvenida');
  });

  it('soltar en vacío, fuera del lienzo o cancelar (Escape) no cambia nada (clearOnEmptyDrop)', () => {
    const flow = clone('captacion-leads');
    expect(drop(flow, 'enviar-crm', '/onError', null)).toEqual({ kind: 'none' });
    expect(drop(flow, 'enviar-crm', '/onError', 'aviso-error', true)).toEqual({ kind: 'none' });
    expect(drop(flow, 'enviar-crm', '/onError', null, true)).toEqual({ kind: 'none' });
  });

  it('sobre el propio nodo se rechaza (allowSelfDrop), salvo el next de un llm', () => {
    const faq = clone('faq-ia');
    expect(drop(faq, 'pedir-email', '/next', 'pedir-email')).toEqual({ kind: 'reject', reason: 'self' });
    expect(drop(faq, 'asistente', '/onExhausted', 'asistente')).toEqual({ kind: 'reject', reason: 'self' });
    const own = drop(faq, 'asistente', '/next', 'asistente');
    expect(own.kind === 'connect' && nodeOf(own.flow, 'asistente').next).toBe('asistente');
    expect(canDropOn(faq, 'asistente', '/next', 'asistente')).toBe(true);
    expect(canDropOn(faq, 'asistente', '/onExhausted', 'asistente')).toBe(false);
    expect(canDropOn(faq, 'pedir-email', '/next', 'fin-resuelto')).toBe(true);
  });

  // Tras conectar, el validador ya no dice que falte el next de message-1.
  it('Conectar una salida vacía arrastrando', () => {
    const hola = structuredClone(FLOWS.hola) as FlowDoc;
    const added = addNode(hola, 'message', displayPositions(hola), { x: 400, y: 0 })!;
    expect(validateFlow(added.flow).issues.map((issue) => `${issue.nodeId}: ${issue.message}`)).toContain("message-1: falta la propiedad obligatoria 'next'");
    const result = drop(added.flow, 'message-1', '/next', 'fin');
    expect(result.kind).toBe('connect');
    if (result.kind !== 'connect') return;
    expect(nodeOf(result.flow, 'message-1').next).toBe('fin');
    const messages = validateFlow(result.flow).issues.filter((issue) => issue.nodeId === 'message-1').map((issue) => issue.message);
    expect(messages).not.toContain("falta la propiedad obligatoria 'next'");
  });

  it('una salida de un nodo que no existe no cambia nada', () => {
    expect(drop(clone('hola'), 'nada', '/next', 'fin')).toEqual({ kind: 'none' });
  });
});
