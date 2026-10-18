import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { hasShapeProblems, problemPart, problemsAt, problemsByNode, problemsOf, summarizeProblems, type Problem } from '@/lib/editor/issues-view';
import type { FlowDoc } from '@/lib/editor/json-edit';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;

describe('issues-view', () => {
  it('agrupa por nodo (con un Map: constructor es un id más) y por puntero', () => {
    const flow = { specVersion: '0.1', id: 'x', name: 'X', start: 'constructor', nodes: [{ id: 'constructor', type: 'message', content: [{ kind: 'text', text: 'a' }] }, { id: '__proto__', type: 'end' }] } as FlowDoc;
    const problems = problemsOf(validateFlow(flow));
    const byNode = problemsByNode(problems);
    expect(byNode.get('constructor')).toEqual({ issues: 1, warnings: 0 });
    expect(byNode.get('__proto__')).toEqual({ issues: 1, warnings: 0 });
    expect(byNode.get('toString')).toBeUndefined();
    expect(problemsAt(problems, '/nodes/0').map((problem) => problem.message)).toEqual(["falta la propiedad obligatoria 'next'"]);
  });

  it('los problemas de un campo cuelgan de su puntero por segmentos (/a/b no cuelga de /a/bc)', () => {
    const problem = (path: string): Problem => ({ kind: 'issue', message: path, path, nodeId: null, layer: 'semantic' });
    const all = [problem('/nodes/1'), problem('/nodes/1/next'), problem('/nodes/10'), problem('/nodes/10/next'), problem('')];
    expect(problemsAt(all, '/nodes/1').map((entry) => entry.path)).toEqual(['/nodes/1', '/nodes/1/next']);
    expect(problemsAt(all, '/nodes/10/next').map((entry) => entry.path)).toEqual(['/nodes/10/next']);
  });

  it('los avisos de una cabecera llegan a su campo (credential_header_literal)', () => {
    const flow = clone('captacion-leads');
    const crm = (flow.nodes as { id: string; request: { headers: Record<string, unknown> } }[]).findIndex((node) => node.id === 'enviar-crm');
    (flow.nodes as { request: { headers: Record<string, unknown> } }[])[crm]!.request.headers = { Authorization: 'Bearer abc123' };
    const problems = problemsOf(validateFlow(flow));
    const at = problemsAt(problems, `/nodes/${crm}/request/headers/Authorization`);
    expect(at).toHaveLength(1);
    expect(at[0]).toMatchObject({ kind: 'warning', nodeId: 'enviar-crm' });
  });

  it('hasShapeProblems distingue los de forma', () => {
    expect(hasShapeProblems(validateFlow({ id: 'x' }))).toBe(true);
    expect(hasShapeProblems(validateFlow({ specVersion: '0.1', id: 'x', name: 'X', start: 'nada', nodes: [{ id: 'a', type: 'end' }] }))).toBe(false);
    expect(hasShapeProblems(validateFlow(clone('captacion-leads')))).toBe(false);
  });

  it('resume en español', () => {
    const issue: Problem = { kind: 'issue', message: '', path: '', nodeId: null, layer: 'shape' };
    const warning: Problem = { ...issue, kind: 'warning', layer: null };
    expect(summarizeProblems([])).toBe('Sin problemas');
    expect(summarizeProblems([issue])).toBe('1 problema');
    expect(summarizeProblems([issue, issue, issue, warning])).toBe('3 problemas y 1 aviso');
    expect(summarizeProblems([warning, warning])).toBe('2 avisos');
  });

  it('el nodo de un problema, o «Flujo»', () => {
    expect(problemPart({ kind: 'issue', message: '', path: '/start', nodeId: null, layer: 'semantic' })).toBe('Flujo');
    expect(problemPart({ kind: 'issue', message: '', path: '', nodeId: 'a', layer: 'semantic' })).toBe('a');
  });

  it('los avisos se recortan para mostrar a 100 más uno', () => {
    const flow = clone('captacion-leads');
    const crm = (flow.nodes as { id: string }[]).findIndex((node) => node.id === 'enviar-crm');
    (flow.nodes as { request: { headers: Record<string, unknown> } }[])[crm]!.request.headers = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`Authorization${index}`, 'x']));
    const verdict = validateFlow(flow);
    expect(verdict.warnings.length).toBeLessThanOrEqual(150);
    expect(problemsOf(verdict).length).toBeLessThanOrEqual(101);
  });
});
