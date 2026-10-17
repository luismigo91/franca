import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('paridad de spec-text.ts', () => {
  it('la copia de la web es byte a byte la del motor', () => {
    expect(read('./helpers/spec-text.ts')).toBe(read('../../../packages/engine/tests/helpers/spec-text.ts'));
  });
});
