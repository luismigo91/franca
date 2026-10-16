import { describe, expect, it } from 'vitest';
import * as engine from '../src/index.js';

describe('constantes públicas', () => {
  it('tienen los valores del contrato', () => {
    expect(engine.STATE_VERSION).toBe(1);
    expect(engine.MAX_STEPS_PER_ADVANCE).toBe(200);
    expect(engine.DEFAULT_TYPING_DELAY_MS).toBe(600);
    expect(engine.MAX_PATTERN_SIZE).toBe(1000);
    expect(engine.MAX_RENDERED_LENGTH).toBe(16384);
    expect(engine.MAX_INPUT_LENGTH).toBe(4096);
    expect(engine.INVALID_ANSWER_REASONS).toEqual([
      'too_long',
      'required',
      'invalid_format',
      'out_of_range',
      'pattern_mismatch',
    ]);
    expect(engine.MAX_NESTING_DEPTH).toBe(1000);
    expect(engine.MAX_PATTERN_DEPTH).toBe(100);
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

describe('API pública', () => {
  it('exporta en runtime exactamente lo de D2', () => {
    expect(Object.keys(engine).sort()).toEqual(
      [
        'DEFAULT_TYPING_DELAY_MS',
        'INVALID_ANSWER_REASONS',
        'MAX_INPUT_LENGTH',
        'MAX_NESTING_DEPTH',
        'MAX_PATTERN_DEPTH',
        'MAX_PATTERN_SIZE',
        'MAX_RENDERED_LENGTH',
        'MAX_STEPS_PER_ADVANCE',
        'REJECTION_CODES',
        'SESSION_ERROR_CODES',
        'STATE_VERSION',
        'continueSession',
        'startSession',
      ].sort(),
    );
  });

  it('startSession y continueSession son asíncronas', () => {
    expect(engine.startSession({ flow: {} })).toBeInstanceOf(Promise);
    expect(engine.continueSession({ flow: {}, state: {}, input: null })).toBeInstanceOf(Promise);
  });
});
