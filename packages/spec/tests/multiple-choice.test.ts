import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

type FlowNode = Record<string, unknown> & { choices?: Record<string, unknown>[] };
type LeadsFlow = Record<string, unknown> & { nodes: FlowNode[] };

const at = (flow: LeadsFlow, index: number): FlowNode => flow.nodes[index]!;

const leads = (): LeadsFlow =>
  JSON.parse(readFileSync(new URL('../examples/captacion-leads.json', import.meta.url), 'utf8')) as LeadsFlow;
const NEEDS_NEXT = 'en selección múltiple, el nodo necesita next';

const issuesOf = (flow: unknown) => validateFlow(flow).issues.map(({ layer, path, nodeId, message }) => ({ layer, path, nodeId, message }));

describe('Selección múltiple: la regla «el nodo necesita next»', () => {
  it('el issue lleva capa semantic, el path del índice real, el nodeId y el mensaje exacto', () => {
    const flow = leads();
    at(flow, 3).multiple = true;
    expect(issuesOf(flow)).toEqual([{ layer: 'semantic', path: '/nodes/3', nodeId: 'pedir-tamano', message: NEEDS_NEXT }]);
  });

  it('el índice del path sigue al nodo cuando se mueve de sitio', () => {
    const flow = leads();
    const [node] = flow.nodes.splice(3, 1);
    node!.multiple = true;
    flow.nodes.splice(1, 0, node!);
    at(flow, 0).next = 'pedir-tamano';
    at(flow, 2).next = 'pedir-email';
    const found = issuesOf(flow).filter((i) => i.message === NEEDS_NEXT);
    expect(found).toEqual([{ layer: 'semantic', path: '/nodes/1', nodeId: 'pedir-tamano', message: NEEDS_NEXT }]);
  });

  it('dos inputs múltiples sin next dan dos issues, cada uno con su path y su nodeId', () => {
    const flow = leads();
    at(flow, 3).multiple = true;
    Object.assign(at(flow, 1), { inputType: 'choice', multiple: true, choices: [{ id: 'si', label: 'Sí' }, { id: 'no', label: 'No' }] });
    delete at(flow, 1).next;
    delete at(flow, 1).placeholder;
    delete at(flow, 1).validation;
    const found = issuesOf(flow).filter((i) => i.message === NEEDS_NEXT);
    expect(found.map((i) => [i.path, i.nodeId])).toEqual([
      ['/nodes/1', 'pedir-nombre'],
      ['/nodes/3', 'pedir-tamano'],
    ]);
  });

  it('con next en el nodo es válido aunque alguna opción tenga next y otra no', () => {
    const flow = leads();
    Object.assign(at(flow, 3), { multiple: true, next: 'marcar-pyme' });
    delete at(flow, 3).choices![0]!.next;
    expect(validateFlow(flow).valid).toBe(true);
  });

  it('con next en el nodo y todas las opciones con next también es válido (los next de opción se ignoran pero deben existir)', () => {
    const flow = leads();
    Object.assign(at(flow, 3), { multiple: true, next: 'marcar-pyme' });
    expect(validateFlow(flow).valid).toBe(true);
    at(flow, 3).choices![0]!.next = 'fantasma';
    expect(issuesOf(flow).map((i) => i.message)).toEqual(['choices[pequena].next apunta a un nodo inexistente: fantasma']);
  });

  it('multiple: false explícito sigue exigiendo next en cada opción y no el next del nodo', () => {
    const flow = leads();
    at(flow, 3).multiple = false;
    at(flow, 3).next = 'marcar-pyme';
    delete at(flow, 3).choices![1]!.next;
    expect(issuesOf(flow).map((i) => i.message)).toEqual(['en selección única, cada opción necesita next']);
  });

  it('en selección única, el next del nodo no sustituye al de las opciones y no dispara la regla de múltiple', () => {
    const flow = leads();
    at(flow, 3).next = 'marcar-pyme';
    expect(validateFlow(flow).valid).toBe(true);
  });

  it('un next del nodo que apunta a un nodo inexistente o a sí mismo es un issue, además de cumplir la regla', () => {
    const missing = leads();
    Object.assign(at(missing, 3), { multiple: true, next: 'fantasma' });
    expect(issuesOf(missing).map((i) => i.message)).toEqual(expect.arrayContaining(['next apunta a un nodo inexistente: fantasma']));
    expect(issuesOf(missing).map((i) => i.message)).not.toContain(NEEDS_NEXT);
    const self = leads();
    Object.assign(at(self, 3), { multiple: true, next: 'pedir-tamano' });
    expect(issuesOf(self).map((i) => i.message)).toContain('next apunta a sí mismo');
  });

  it('la regla solo aplica a inputType choice: un input de texto con multiple y sin next ya falla por forma, no por la regla', () => {
    const flow = leads();
    at(flow, 1).multiple = true;
    delete at(flow, 1).next;
    const result = validateFlow(flow);
    expect(result.valid).toBe(false);
    expect(result.issues.every((i) => i.message !== NEEDS_NEXT)).toBe(true);
  });

  it('multiple distinto de boolean es un error de forma y no activa la regla semántica', () => {
    for (const bad of ['true', 1, null, [], {}]) {
      const flow = leads();
      at(flow, 3).multiple = bad;
      const result = validateFlow(flow);
      expect(result.valid, JSON.stringify(bad)).toBe(false);
      expect(result.issues.every((i) => i.layer === 'shape'), JSON.stringify(bad)).toBe(true);
    }
  });

  it('la regla se evalúa también con el input inalcanzable y junto con otros errores semánticos', () => {
    const flow = leads();
    at(flow, 3).multiple = true;
    at(flow, 2).next = 'marcar-pyme'; // pedir-tamano queda inalcanzable
    const messages = issuesOf(flow).map((i) => i.message);
    expect(messages).toContain(NEEDS_NEXT);
    expect(messages).toContain('nodo inalcanzable desde start');
  });

  it('un flujo con la regla incumplida no es válido y no devuelve flow', () => {
    const flow = leads();
    at(flow, 3).multiple = true;
    const result = validateFlow(flow);
    expect(result.valid).toBe(false);
    expect(result).not.toHaveProperty('flow');
  });
});
