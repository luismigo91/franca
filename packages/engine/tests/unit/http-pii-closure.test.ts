import type { Flow } from '@franca/spec';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Se cuenta cuántas veces se analiza una plantilla: el cierre por set debe analizar cada asignación una vez.
vi.mock('../../src/template.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/template.js')>();
  return { ...original, templateVariables: vi.fn(original.templateVariables) };
});

const { templateVariables } = await import('../../src/template.js');
const { personalVariables } = await import('../../src/http/request.js');
const { startSession } = await import('../../src/index.js');
const { end, flowOf, httpNode, message, variable } = await import('../helpers/flows.js');
const { always, respond } = await import('../helpers/http-host.js');

/** Una sola asignación por set, encadenadas en orden inverso de declaración: v0 = {{v1}}, v1 = {{v2}}… y la última cita `email`. */
function inverseChain(length: number): Flow {
  const names = Array.from({ length }, (_, i) => `v${i}`);
  const assignments = names.map((name, i) => ({ variable: name, value: i + 1 < length ? `{{v${i + 1}}}` : '{{email}}' }));
  return flowOf(
    [{ id: 's', type: 'set', assignments, next: 'fin' }, end('fin')],
    { variables: [variable('email', { pii: true }), ...names.map((n) => variable(n))] },
  ) as unknown as Flow;
}

describe('Hipótesis: el cierre de containsPii es lineal y perezoso', () => {
  beforeEach(() => {
    vi.mocked(templateVariables).mockClear();
  });

  it('la cadena inversa de 4000 asignaciones se analiza una vez por asignación de tipo string', () => {
    const flow = inverseChain(4000);
    const personal = personalVariables(flow);
    expect(vi.mocked(templateVariables).mock.calls.length).toBeLessThanOrEqual(4000);
    expect(personal.size).toBe(4001);
    expect(personal.has('v0')).toBe(true);
  });

  it('y termina en milisegundos (el cuadrático antiguo tardaba segundos)', () => {
    const started = performance.now();
    personalVariables(inverseChain(4000));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('las asignaciones que no son strings no se analizan', () => {
    const flow = flowOf([{ id: 's', type: 'set', assignments: [{ variable: 'a', value: 3 }, { variable: 'b', value: null }, { variable: 'c', value: true }], next: 'fin' }, end('fin')], {
      variables: [variable('a'), variable('b'), variable('c')],
    }) as unknown as Flow;
    personalVariables(flow);
    expect(vi.mocked(templateVariables).mock.calls).toHaveLength(0);
  });

  it('una asignación que cita dos veces la misma variable la enlaza una vez', () => {
    const flow = flowOf([{ id: 's', type: 'set', assignments: [{ variable: 'a', value: '{{email}}{{email}}' }], next: 'fin' }, end('fin')], {
      variables: [variable('email', { pii: true }), variable('a')],
    }) as unknown as Flow;
    expect([...personalVariables(flow)].sort()).toEqual(['a', 'email']);
  });

  it('un ciclo entre variables termina', () => {
    const flow = flowOf([{ id: 's', type: 'set', assignments: [{ variable: 'a', value: '{{b}}' }, { variable: 'b', value: '{{a}}{{email}}' }], next: 'fin' }, end('fin')], {
      variables: [variable('email', { pii: true }), variable('a'), variable('b')],
    }) as unknown as Flow;
    expect([...personalVariables(flow)].sort()).toEqual(['a', 'b', 'email']);
  });

  it('un flujo sin http no calcula las variables personales en ninguna operación', async () => {
    const flow = inverseChain(150);
    await startSession({ flow });
    await startSession({ flow: flowOf([message('m', 'Hola', 'fin'), end('fin')]) });
    expect(vi.mocked(templateVariables).mock.calls).toHaveLength(0);
  });

  it('un flujo con http lo calcula una sola vez por operación aunque haya varios http', async () => {
    const chain = inverseChain(150);
    const nodes = [...(chain.nodes as never[]).slice(0, 1)].map((n: Record<string, unknown>) => ({ ...n, next: 'a' }));
    const flow = flowOf([...nodes, httpNode('a', { url: 'https://api.example.com/{{v0}}' }, { next: 'b', onError: 'b' }), httpNode('b', {}, { next: 'fin', onError: 'fin' }), end('fin')], {
      variables: chain.variables as never[],
    });
    const host = always(respond(200));
    await startSession({ flow }, host.host);
    const analyses = vi.mocked(templateVariables).mock.calls.length;
    // 150 asignaciones del cierre (una vez, no por http) + la url de cada uno de los dos http
    expect(analyses).toBe(152);
    expect(host.requests[0]!.containsPii).toBe(true);
    expect(host.requests[1]!.containsPii).toBe(false);
  });
});
