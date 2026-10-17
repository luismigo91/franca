import { describe, expect, it } from 'vitest';
import * as spec from '../src/index.js';
import type { FlowWarning, FlowWarningCode } from '../src/index.js';

describe('exportaciones de @franca/spec', () => {
  it('exporta la profundidad, los topes y los avisos con sus valores', () => {
    expect(spec.MAX_FLOW_DEPTH).toBe(1000);
    expect(spec.MAX_FLOW_ISSUES).toBe(100);
    expect(spec.MAX_FLOW_WARNINGS).toBe(100);
    expect(spec.FLOW_WARNING_CODES).toEqual([
      'url_template_in_origin',
      'credential_header_not_secret',
      'credential_header_literal',
      'too_many_warnings',
    ]);
    expect(typeof spec.exceedsFlowDepth).toBe('function');
    expect(typeof spec.capWarnings).toBe('function');
  });

  it('los tipos de aviso se pueden usar desde fuera', () => {
    const code: FlowWarningCode = 'credential_header_literal';
    const warning: FlowWarning = { code, path: '/nodes/0', message: 'x' };
    expect(spec.capWarnings([warning])).toEqual([warning]);
  });
});
