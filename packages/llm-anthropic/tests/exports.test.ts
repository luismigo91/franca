import type { LlmCapability } from '@franca/engine';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('API pública', () => {
  it('exporta en runtime exactamente lo de D15', () => {
    expect(Object.keys(pkg).sort()).toEqual(['DEFAULT_ANTHROPIC_MODEL', 'DEFAULT_ANTHROPIC_MODELS', 'createAnthropicClient', 'createAnthropicProvider']);
  });

  it('createAnthropicProvider devuelve exactamente la capacidad llm del motor (sin redefinir sus tipos)', () => {
    expectTypeOf(pkg.createAnthropicProvider).returns.toEqualTypeOf<LlmCapability>();
    expectTypeOf<Parameters<LlmCapability>[0]>().toEqualTypeOf<import('@franca/engine').LlmTurnRequest>();
  });

  it('los tipos públicos se pueden importar', () => {
    expectTypeOf<pkg.AnthropicProviderOptions['onWarning']>().toEqualTypeOf<((warning: pkg.AnthropicWarning) => void) | undefined>();
    expectTypeOf<pkg.AnthropicEffort>().toEqualTypeOf<'low' | 'medium' | 'high' | 'xhigh' | 'max'>();
    expectTypeOf<pkg.AnthropicWarning['code']>().toEqualTypeOf<'temperature_ignored'>();
    expectTypeOf<keyof pkg.AnthropicPrices>().toEqualTypeOf<'inputUsdPerMTok' | 'outputUsdPerMTok' | 'cacheReadUsdPerMTok' | 'cacheWriteUsdPerMTok'>();
    expectTypeOf<keyof pkg.AnthropicModelConfig>().toEqualTypeOf<'prices' | 'longPrompt' | 'effort' | 'serverFallback'>();
  });
});
