import { describe, expect, it } from 'vitest';
import { toFlowResource, toFlowSummary, toVersionResource, toVersionSummary } from './flow-resources.js';

const hola = { specVersion: '0.1', id: 'hola', name: 'Hola', start: 'fin', nodes: [{ id: 'fin', type: 'end' }] };
const created = new Date('2026-10-17T10:30:00.000Z');
const updated = new Date('2026-10-17T10:31:02.003Z');

describe('recursos', () => {
  const row = {
    id: 'hola',
    nameJson: JSON.stringify('Hola'),
    draft: JSON.stringify(hola),
    revision: 2,
    latestVersion: null,
    unpublishedChanges: true,
    createdAt: created,
    updatedAt: updated,
  };

  it('el recurso flujo tiene exactamente sus claves, en orden', () => {
    const resource = toFlowResource(row);
    expect(Object.keys(resource)).toEqual(['id', 'name', 'revision', 'latestVersion', 'unpublishedChanges', 'createdAt', 'updatedAt', 'flow', 'warnings']);
    expect(resource).toEqual({
      id: 'hola',
      name: 'Hola',
      revision: 2,
      latestVersion: null,
      unpublishedChanges: true,
      createdAt: '2026-10-17T10:30:00.000Z',
      updatedAt: '2026-10-17T10:31:02.003Z',
      flow: hola,
      warnings: [],
    });
  });

  it('el resumen no lleva ni flow ni warnings', () => {
    expect(Object.keys(toFlowSummary(row))).toEqual(['id', 'name', 'revision', 'latestVersion', 'unpublishedChanges', 'createdAt', 'updatedAt']);
  });

  it('el nombre se decodifica del literal JSON, también con caracteres que una columna text no admite', () => {
    const name = 'a\u0000b\ud800c';
    expect(toFlowSummary({ ...row, nameJson: JSON.stringify(name) }).name).toBe(name);
  });

  it('los avisos se recalculan sobre el borrador guardado', () => {
    const flow = {
      ...hola,
      nodes: [
        { id: 'llamar', type: 'http', request: { method: 'GET', url: 'https://{{x}}.example.com', headers: { Authorization: 'Bearer abc' } }, next: 'fin', onError: 'fin' },
        { id: 'fin', type: 'end' },
      ],
      start: 'llamar',
      variables: [{ name: 'x', type: 'string' }],
    };
    const resource = toFlowResource({ ...row, draft: JSON.stringify(flow) });
    expect(resource.warnings.map((w) => w.code)).toEqual(['credential_header_literal', 'url_template_in_origin']);
  });

  it('los recursos versión', () => {
    const version = { flowId: 'hola', version: 3, nameJson: '"Hola"', definition: JSON.stringify(hola), publishedAt: updated };
    expect(toVersionSummary(version)).toEqual({ flowId: 'hola', version: 3, name: 'Hola', publishedAt: '2026-10-17T10:31:02.003Z' });
    const resource = toVersionResource(version);
    expect(Object.keys(resource)).toEqual(['flowId', 'version', 'name', 'publishedAt', 'flow', 'warnings']);
    expect(resource.flow).toEqual(hola);
  });
});
