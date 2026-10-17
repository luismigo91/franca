import type { ErrorObject } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { collapse } from '../src/shape.js';
import { timed } from './helpers/flows.js';

const error = (keyword: string, instancePath: string): ErrorObject =>
  ({ keyword, instancePath, schemaPath: '#', params: {} }) as ErrorObject;

/** La definición original (cuadrática): la referencia con la que se compara la versión lineal. */
function collapseByDefinition(errors: ErrorObject[]): ErrorObject[] {
  const within = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`);
  const oneOfPaths = errors.filter((e) => e.keyword === 'oneOf').map((e) => e.instancePath);
  return errors.filter((e) => {
    if (e.keyword === 'if') return false;
    if (e.keyword === 'oneOf') return !oneOfPaths.some((p) => p !== e.instancePath && within(e.instancePath, p));
    return !oneOfPaths.some((p) => within(e.instancePath, p));
  });
}

describe('collapse', () => {
  it('quita los if, sustituye un oneOf por su error y descarta los de cada rama', () => {
    const errors = [
      error('required', '/a'),
      error('type', '/a/b'),
      error('oneOf', '/a'),
      error('if', '/c'),
      error('type', '/c'),
      error('oneOf', '/a/b/d'),
    ];
    expect(collapse(errors).map((e) => `${e.keyword} ${e.instancePath}`)).toEqual(['oneOf /a', 'type /c']);
  });

  it('da lo mismo que su definición con rutas y claves variadas (incluido el oneOf en la raíz)', () => {
    const segments = ['', '/a', '/a/b', '/a/b/c', '/ab', '/a~1b', '/0', '/10', '/a/10'];
    const keywords = ['oneOf', 'type', 'if', 'required', 'oneOf'];
    let seed = 12345;
    const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let round = 0; round < 200; round++) {
      const errors = Array.from({ length: 1 + next(12) }, () => error(keywords[next(keywords.length)]!, segments[next(segments.length)]!));
      expect(collapse(errors), JSON.stringify(errors.map((e) => [e.keyword, e.instancePath]))).toEqual(collapseByDefinition(errors));
    }
  });

  it('es lineal: 40000 errores con 20000 oneOf distintos', () => {
    const errors: ErrorObject[] = [];
    for (let i = 0; i < 20_000; i++) {
      errors.push(error('oneOf', `/items/${i}`), error('type', `/items/${i}/x`));
    }
    const { result, ms } = timed(() => collapse(errors));
    expect(result).toHaveLength(20_000);
    expect(ms).toBeLessThan(500);
  });
});
