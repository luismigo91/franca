import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { leads, timed } from './helpers/flows.js';

const MIB = 1024 * 1024;

describe('Coste acotado de la validación: tiempo', () => {
  it('Un mega de nodos vacíos', () => {
    const flow = leads();
    flow.nodes = Array.from({ length: 340_000 }, () => ({}));
    expect(JSON.stringify(flow).length).toBeGreaterThan(MIB * 0.9);
    const { result, ms } = timed(() => validateFlow(flow));
    expect(result.issues).toHaveLength(101);
    expect(ms).toBeLessThan(2000);
  });

  it('Un error real repetido', () => {
    const flow = leads();
    const broken = { ...flow.nodes[0], color: 'rojo' };
    const copies = Math.ceil(MIB / JSON.stringify(broken).length);
    flow.nodes = Array.from({ length: copies }, () => structuredClone(broken));
    expect(JSON.stringify(flow).length).toBeGreaterThan(MIB * 0.9);
    const { result, ms } = timed(() => validateFlow(flow));
    expect(result.issues).toHaveLength(101);
    expect(ms).toBeLessThan(2000);
  });

  it('Un nodo enorme con errores', () => {
    const flow = leads();
    flow.nodes[7].rules[0].when = { all: Array.from({ length: 200_000 }, () => ({})) };
    const { result, ms } = timed(() => validateFlow(flow));
    expect(result.issues).toEqual([
      {
        layer: 'shape',
        path: '/nodes/7/rules/0/when',
        nodeId: 'ruta-segmento',
        message: 'no coincide con ninguna de las formas permitidas',
      },
    ]);
    expect(ms).toBeLessThan(2000);
  });

  it('Muchas variables rotas', () => {
    const flow = leads();
    flow.variables = Array.from({ length: 200_000 }, () => ({ x: 1 }));
    const { result, ms } = timed(() => validateFlow(flow));
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.layer).toBe('shape');
    expect(result.issues[0]!.path.startsWith('/variables/0')).toBe(true);
    expect(ms).toBeLessThan(2000);
  });

  it('Muchos marcadores en un body profundo', () => {
    const flow = leads();
    flow.variables.push({ name: 'a', type: 'string' });
    let body: unknown = '{{a}}'.repeat(200_000);
    for (let level = 0; level < 990; level++) body = [body];
    flow.nodes[6].request.body = body;
    const { result, ms } = timed(() => validateFlow(flow));
    expect(result.valid).toBe(true);
    expect(ms).toBeLessThan(500);
  });
});

describe('Coste acotado de la validación: detalle', () => {
  it('Detalle en un nodo normal', () => {
    const flow = leads();
    Object.assign(flow.nodes[6], { timeoutMs: 50, color: 'rojo' });
    expect(validateFlow(flow).issues).toEqual([
      { layer: 'shape', path: '/nodes/6', nodeId: 'enviar-crm', message: "propiedad no permitida 'color'" },
      { layer: 'shape', path: '/nodes/6/timeoutMs', nodeId: 'enviar-crm', message: 'debe ser >= 100' },
    ]);
  });

  it('Un nodo grande da un solo error', () => {
    const flow = leads();
    Object.assign(flow.nodes[6], { timeoutMs: 50, color: 'rojo' });
    flow.nodes[6].request.body = 'x'.repeat(10_000);
    const { issues } = validateFlow(flow);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ layer: 'shape', nodeId: 'enviar-crm' });
    expect(issues[0]!.path.startsWith('/nodes/6')).toBe(true);
  });
});
