import { describe, expect, it } from 'vitest';
import { MAX_PATTERN_SIZE } from '../../src/constants.js';
import { compilePattern, compileProgram, patternSize } from '../../src/regex/compile.js';
import { parsePattern, PatternError } from '../../src/regex/parse.js';

const sizeOf = (pattern: string) => patternSize(parsePattern(pattern));

describe('tamaño del patrón', () => {
  it.each([
    ['a', 1],
    ['abc', 3],
    ['^a$', 3],
    ['a|bc', 3],
    ['a*', 1],
    ['a+', 1],
    ['a?', 1],
    ['a{3}', 3],
    ['a{2,5}', 5],
    ['a{4,}', 4],
    ['a{0,}', 1],
    ['a{0}', 0],
    ['(ab){3}', 6],
    ['(a{2}){3}', 6],
    ['(?:\\b)*', 1],
    ['', 0],
  ])('%s mide %i', (pattern, size) => {
    expect(sizeOf(pattern)).toBe(size);
  });

  it('un contenido de tamaño 0 repetido mide 0 aunque lleve un contador enorme', () => {
    expect(sizeOf('(?:a{0}){99999999}')).toBe(0);
    expect(() => compilePattern('(?:a{0}){99999999}')).not.toThrow();
  });

  it('un contador desmesurado no produce NaN', () => {
    const huge = '9'.repeat(400);
    expect(sizeOf(`(?:a{0}){${huge}}`)).toBe(0);
    expect(sizeOf(`a{${huge}}`)).toBe(MAX_PATTERN_SIZE + 1);
  });
});

describe('límite de tamaño', () => {
  it('a{1000} se admite', () => {
    expect(() => compilePattern('a{1000}')).not.toThrow();
  });

  it.each(['a{1001}', '(a{40}){40}', 'a{1,1001}'])('%s se rechaza como demasiado grande', (pattern) => {
    expect.assertions(2);
    try {
      compilePattern(pattern);
    } catch (error) {
      expect(error).toBeInstanceOf(PatternError);
      expect((error as PatternError).kind).toBe('too_large');
    }
  });

  it('(a{1000}){1000} se rechaza sin construir el programa', () => {
    const ast = parsePattern('(a{1000}){1000}');
    // Se comprueba que la rama de emisión no se alcanza: si se expandiera, serían 10^6 instrucciones.
    const pushed: number[] = [];
    const push = Array.prototype.push;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
      pushed.push(items.length);
      return push.apply(this, items);
    };
    try {
      expect(() => compileProgram(ast)).toThrow(PatternError);
    } finally {
      Array.prototype.push = push;
    }
    expect(pushed).toEqual([]);
  });

  it('el patrón anidado desmesurado también se rechaza', () => {
    expect(() => compilePattern('((a{1000}){1000}){1000}')).toThrow(PatternError);
  });

  it('un patrón con anidación extrema se rechaza en vez de desbordar la pila', () => {
    const deep = '('.repeat(50_000) + 'a' + ')'.repeat(50_000);
    expect(() => compilePattern(deep)).toThrow(PatternError);
  });
});

describe('programa', () => {
  it('repetir lo que no produce instrucciones no se expande', () => {
    expect(compilePattern('(?:(?:\\b){0}){1000000}').instructions).toEqual([{ op: 'match' }]);
    expect(compilePattern('(?:){1000000}').instructions).toEqual([{ op: 'match' }]);
  });

  it('comparte los átomos repetidos', () => {
    expect(compilePattern('a{500}').atoms).toEqual(['a']);
  });
});
