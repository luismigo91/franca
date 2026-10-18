import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProblemsList, SHAPE_NOTE_TEXT } from '@/components/editor/problems-list';
import { problemsOf, type Problem } from '@/lib/editor/issues-view';
import { validateDraft } from '@/lib/editor/validate-draft';

const render = (problems: Problem[], shapeProblems = false) => renderToStaticMarkup(<ProblemsList problems={problems} shapeProblems={shapeProblems} onPick={() => undefined} />);
const base = { specVersion: '0.1', id: 'x', name: 'X', start: 'a' };

describe('ProblemsList', () => {
  it('sin problemas dice «Sin problemas.»', () => {
    expect(render([])).toContain('Sin problemas.');
    expect(render([])).not.toContain('<ul');
  });

  it('cada problema es un botón «<nodo o Flujo>: <mensaje>» y los avisos van marcados con «Aviso»', () => {
    const flow = { ...base, nodes: [{ id: 'a', type: 'message', content: [{ kind: 'text', text: 'x' }] }] };
    const html = render(problemsOf(validateDraft(flow)));
    expect(html).toContain("a: falta la propiedad obligatoria &#x27;next&#x27;");
    expect(html).toContain('<button');
    const warned = {
      ...base,
      start: 'h',
      nodes: [{ id: 'h', type: 'http', request: { method: 'GET', url: 'https://x.example', headers: { Authorization: 'Bearer abc' } }, next: 'f', onError: 'f' }, { id: 'f', type: 'end' }],
    };
    const warning = render(problemsOf(validateDraft(warned)));
    expect(warning).toContain('<b>Aviso · </b>');
    expect(warning).toContain('h: ');
  });

  it('un problema sin nodo dice «Flujo»', () => {
    expect(render(problemsOf(validateDraft({ ...base, start: 'nada', nodes: [{ id: 'a', type: 'end' }] })))).toContain('Flujo: start apunta a un nodo inexistente: nada');
  });

  it('con problemas de forma avisa de que el resto llegará al corregirlos', () => {
    expect(render([], true)).toContain(SHAPE_NOTE_TEXT);
    expect(render([])).not.toContain(SHAPE_NOTE_TEXT);
  });

  it('el id de un nodo y las partes del flujo con tipo inesperado se pintan con asText', () => {
    const odd = [{ kind: 'issue', message: 'm', path: '/x', nodeId: '{}', layer: 'semantic' } as Problem, { kind: 'issue', message: 'n', path: '', nodeId: null, layer: 'shape' } as Problem];
    const html = render(odd);
    expect(html).toContain('{}: m');
    expect(html).toContain('Flujo: n');
    expect(html).not.toContain('[object Object]');
    const weird = [{ kind: 'issue', message: 'm', path: '/x', nodeId: { a: 1 } as unknown as string, layer: 'semantic' } as Problem];
    expect(render(weird)).not.toContain('[object Object]');
  });

  it('tiene el título enfocable de la lista', () => {
    expect(render([])).toContain('id="problems-title" tabindex="-1"');
  });
});
