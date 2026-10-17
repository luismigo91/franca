import { readFileSync } from 'node:fs';
import { exceedsFlowDepth, MAX_FLOW_DEPTH, validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { MAX_NESTING_DEPTH } from '../src/constants.js';
import { startSession } from '../src/index.js';

const leads = (): any =>
  JSON.parse(readFileSync(new URL('../../spec/examples/captacion-leads.json', import.meta.url), 'utf8'));

/** `captacion-leads` con una variable `j` de tipo `json` cuyo `default` anida `levels` arrays. */
function withJsonDefault(levels: number): any {
  let json: unknown = 1;
  for (let level = 0; level < levels; level++) json = [json];
  const flow = leads();
  flow.variables.push({ name: 'j', type: 'json', default: json });
  return flow;
}

describe('Paridad de la profundidad máxima entre @franca/spec y el motor', () => {
  it('MAX_FLOW_DEPTH es MAX_NESTING_DEPTH', () => {
    expect(MAX_FLOW_DEPTH).toBe(MAX_NESTING_DEPTH);
  });

  it('miden igual: 1000 niveles caben y 1001 no', () => {
    expect(exceedsFlowDepth(withJsonDefault(997))).toBe(false);
    expect(exceedsFlowDepth(withJsonDefault(998))).toBe(true);
  });

  it('Mismo issue que el motor', async () => {
    const flow = withJsonDefault(998);
    const result = await startSession({ flow });
    expect(result).toMatchObject({ ok: false, code: 'invalid_flow' });
    expect('issues' in result && result.issues).toEqual(validateFlow(flow).issues);
  });
});
