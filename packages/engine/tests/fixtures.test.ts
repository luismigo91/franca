import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { fixtureNames, readFixture } from './helpers/files.js';

describe('fixtures', () => {
  it('hay fixtures', () => {
    expect(fixtureNames().length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixtureNames())('%s es un flujo válido', (name) => {
    const result = validateFlow(readFixture(name));
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
