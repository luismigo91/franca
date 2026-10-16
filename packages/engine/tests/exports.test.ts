import { describe, expect, it } from 'vitest';
import * as engine from '../src/index.js';

describe('constantes públicas', () => {
  it('tienen los valores del contrato', () => {
    expect(engine.STATE_VERSION).toBe(1);
    expect(engine.MAX_STEPS_PER_ADVANCE).toBe(200);
    expect(engine.DEFAULT_TYPING_DELAY_MS).toBe(600);
    expect(engine.MAX_PATTERN_SIZE).toBe(1000);
    expect(engine.MAX_RENDERED_LENGTH).toBe(16384);
    expect(engine.SESSION_ERROR_CODES).toEqual([
      'unsupported_node',
      'invalid_rule',
      'step_limit_exceeded',
      'value_too_large',
    ]);
    expect(engine.REJECTION_CODES).toEqual([
      'invalid_flow',
      'invalid_contact',
      'invalid_state',
      'state_mismatch',
      'session_not_active',
    ]);
  });
});
