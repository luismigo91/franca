import { schema } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { MAX_FLOW_BYTES } from '@/lib/editor/limits';
import { NODE_TYPE_LABELS } from '@/lib/editor/node-types';
import { effectiveSpec } from './helpers/spec-text';

describe('paridad del editor con sus fuentes', () => {
  it('MAX_FLOW_BYTES es el número de «Guardar el borrador» en la spec efectiva y el cuerpo máximo de flows-api', () => {
    // El número tal como lo escribe la spec: con espacios entre los miles.
    const written = String(MAX_FLOW_BYTES).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    expect(written).toBe('1 048 576');
    expect(effectiveSpec('web-editor').blocks.get('Guardar el borrador') ?? '').toContain(`pasa de ${written} bytes`);
    expect(effectiveSpec('flows-api').text).toContain(`Un cuerpo de más de ${written} bytes`);
  });

  it('NODE_TYPE_LABELS tiene exactamente los tipos de $defs.node.oneOf', () => {
    const oneOf = schema.$defs.node.oneOf.map((entry) => entry.$ref.split('/').pop()!.replace(/Node$/, ''));
    expect([...NODE_TYPE_LABELS.keys()].sort()).toEqual([...oneOf].sort());
  });
});
