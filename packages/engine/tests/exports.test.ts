import { describe, expect, it } from 'vitest';
import * as engine from '../src/index.js';
import * as conformance from '../src/conformance/index.js';

describe('constantes públicas', () => {
  it('tienen los valores del contrato', () => {
    expect(engine.STATE_VERSION).toBe(1);
    expect(engine.MAX_STEPS_PER_ADVANCE).toBe(200);
    expect(engine.DEFAULT_TYPING_DELAY_MS).toBe(600);
    expect(engine.MAX_PATTERN_SIZE).toBe(1000);
    expect(engine.MAX_RENDERED_LENGTH).toBe(16384);
    expect(engine.MAX_EXTERNAL_CALLS_PER_ADVANCE).toBe(10);
    expect(engine.MAX_URL_LENGTH).toBe(8192);
    expect(engine.MAX_REQUEST_BODY_LENGTH).toBe(65536);
    expect(engine.MAX_RESPONSE_BODY_LENGTH).toBe(1048576);
    expect(engine.HTTP_ERROR_REASONS).toEqual([
      'invalid_url',
      'invalid_header_value',
      'body_too_large',
      'http_status',
      'timeout',
      'network_error',
      'blocked',
      'response_too_large',
      'invalid_response',
    ]);
    expect(engine.MAX_INPUT_LENGTH).toBe(4096);
    expect(engine.INVALID_ANSWER_REASONS).toEqual([
      'too_long',
      'required',
      'invalid_format',
      'out_of_range',
      'pattern_mismatch',
    ]);
    expect(engine.LLM_EXIT_REASONS).toEqual(['max_turns', 'cost_cap', 'refusal', 'provider_error', 'invalid_turn']);
    expect(engine.MAX_NESTING_DEPTH).toBe(1000);
    expect(engine.MAX_PATTERN_DEPTH).toBe(100);
    expect(engine.SESSION_ERROR_CODES).toEqual([
      'unsupported_node',
      'invalid_rule',
      'step_limit_exceeded',
      'value_too_large',
      'invalid_validation',
      'retries_exhausted',
      'invalid_http_config',
      'missing_secret',
      'http_host_error',
      'http_limit_exceeded',
    ]);
    expect(engine.REJECTION_CODES).toEqual([
      'invalid_flow',
      'invalid_contact',
      'invalid_state',
      'state_mismatch',
      'session_not_active',
      'invalid_input',
    ]);
  });
});

describe('API pública', () => {
  it('exporta en runtime exactamente lo de D2', () => {
    expect(Object.keys(engine).sort()).toEqual(
      [
        'DEFAULT_TYPING_DELAY_MS',
        'HTTP_ERROR_REASONS',
        'MAX_EXTERNAL_CALLS_PER_ADVANCE',
        'MAX_REQUEST_BODY_LENGTH',
        'MAX_RESPONSE_BODY_LENGTH',
        'MAX_URL_LENGTH',
        'INVALID_ANSWER_REASONS',
        'LLM_EXIT_REASONS',
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
        'createLlmCapability',
        'startSession',
      ].sort(),
    );
  });

  it('startSession y continueSession son asíncronas', () => {
    expect(engine.startSession({ flow: {} })).toBeInstanceOf(Promise);
    expect(engine.continueSession({ flow: {}, state: {}, input: null })).toBeInstanceOf(Promise);
  });
});

describe('subruta @franca/engine/conformance', () => {
  it('exporta en runtime exactamente el catálogo, las direcciones internas y el margen', () => {
    expect(Object.keys(conformance).sort()).toEqual(['CALL_DEADLINE_MARGIN_MS', 'CONFORMANCE_INTERNAL_ADDRESSES', 'HOST_CONFORMANCE_CASES']);
  });

  it('la entrada principal no los reexporta', () => {
    for (const name of Object.keys(conformance)) expect(Object.keys(engine)).not.toContain(name);
  });
});
