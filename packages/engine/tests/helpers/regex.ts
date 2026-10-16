import { expect } from 'vitest';
import { compilePattern, patternSize } from '../../src/regex/compile.js';
import { parsePattern } from '../../src/regex/parse.js';

/** Oráculo: el motor nativo, solo seguro con textos cortos. */
export const native = (pattern: string, text: string): boolean => new RegExp(pattern, 'u').test(text);

/**
 * V8 prueba `\B` entre las dos mitades de un par sustituto aunque el modo Unicode lo prohíbe
 * (`/\B/u.test('a😀b')` da `true`; la spec dice `false`): el oráculo no es fiable ahí.
 */
export const oracleIsUnreliable = (pattern: string, text: string): boolean =>
  pattern.includes('\\B') && /[\ud800-\udfff]/.test(text);

/** PRNG con semilla fija (mulberry32): sin dependencias y reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Para todo patrón aceptado: instrucciones ≤ 2 · tamaño + 1 y tamaño 0 ⇔ no emite nada. */
export function expectProgramBound(pattern: string): void {
  const size = patternSize(parsePattern(pattern));
  const { instructions } = compilePattern(pattern);
  expect(instructions.length, `/${pattern}/`).toBeLessThanOrEqual(2 * size + 1);
  expect(size === 0, `/${pattern}/`).toBe(instructions.length === 1);
}
