import { describe, expect, it } from 'vitest';
import { readFlowResource, readVersionResource } from '@/lib/editor/api-types';
import { FLOW_BODY, VERSION_BODY } from '../../../tests/helpers/real-flow-shapes';

const good = () => JSON.parse(FLOW_BODY) as Record<string, unknown>;

describe('readFlowResource', () => {
  it('acepta el recurso real de la API', () => {
    const resource = readFlowResource(good());
    expect(resource).toMatchObject({ id: 'hola', name: 'Hola', revision: 1, latestVersion: null, unpublishedChanges: true });
    expect(resource?.flow.start).toBe('fin');
  });

  it('rechaza formas rotas', () => {
    const broken: [string, (body: Record<string, unknown>) => void][] = [
      ['sin id', (body) => delete body.id],
      ['revision decimal', (body) => (body.revision = 1.5)],
      ['latestVersion texto', (body) => (body.latestVersion = 'x')],
      ['unpublishedChanges texto', (body) => (body.unpublishedChanges = 'si')],
      ['flow nulo', (body) => (body.flow = null)],
      ['flow lista', (body) => (body.flow = [])],
      ['nodes no lista', (body) => (body.flow = { start: 'a', nodes: 'x' })],
      ['nodes con elementos que no son objetos', (body) => (body.flow = { start: 'a', nodes: [null] })],
      ['nodo con id que no es texto', (body) => (body.flow = { start: 'a', nodes: [{ id: 5 }] })],
      ['start que no es texto', (body) => (body.flow = { start: 5, nodes: [{ id: 'a' }] })],
    ];
    for (const [name, change] of broken) {
      const body = good();
      change(body);
      expect(readFlowResource(body), name).toBeNull();
    }
    for (const value of [null, 5, 'x', [], undefined]) expect(readFlowResource(value)).toBeNull();
  });

  it('ignora campos que no usa (createdAt, warnings…)', () => {
    expect(readFlowResource({ ...good(), extra: 1 })).not.toBeNull();
  });
});

describe('readVersionResource', () => {
  it('acepta la forma real y rechaza las rotas', () => {
    expect(readVersionResource(JSON.parse(VERSION_BODY))).toEqual({ flowId: 'hola', version: 1, name: 'Hola 2' });
    for (const value of [null, {}, { flowId: 'a', version: '1', name: 'x' }, { flowId: 5, version: 1, name: 'x' }, { flowId: 'a', version: 1 }]) expect(readVersionResource(value)).toBeNull();
  });
});

describe('readFlowResource: lo que la API no guarda (QA-6)', () => {
  const body = (flow: unknown) => ({ ...good(), flow });

  it('rechaza un borrador de más de 1000 niveles (mutante skipDepthOnRead)', () => {
    let deep: unknown = 1;
    for (let level = 0; level < 1001; level++) deep = [deep];
    expect(readFlowResource(body({ start: 'a', nodes: [{ id: 'a' }], x: deep }))).toBeNull();
    let ok: unknown = 1;
    for (let level = 0; level < 900; level++) ok = [ok];
    expect(readFlowResource(body({ start: 'a', nodes: [{ id: 'a' }], x: ok }))).not.toBeNull();
  });

  it('rechaza ids de nodo repetidos (mutante allowDuplicateIds)', () => {
    expect(readFlowResource(body({ start: 'a', nodes: [{ id: 'a' }, { id: 'a' }] }))).toBeNull();
    expect(readFlowResource(body({ start: 'a', nodes: [{ id: 'a' }, { id: 'b' }] }))).not.toBeNull();
  });
});
