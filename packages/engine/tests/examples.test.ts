import { describe, expect, it } from 'vitest';
import { exampleNames, readExample } from './helpers/files.js';
import { startSession } from '../src/index.js';

describe('ejemplos de packages/spec/examples', () => {
  it('hay ejemplos', () => {
    expect(exampleNames().length).toBeGreaterThanOrEqual(2);
  });

  it.each(exampleNames())('%s: arrancar no se rechaza y termina en ended o en unsupported_node', async (name) => {
    const result = await startSession({ flow: readExample(name) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stoppedAtUnsupported = result.state.error?.code === 'unsupported_node';
    expect(result.status === 'ended' || stoppedAtUnsupported).toBe(true);
  });
});
