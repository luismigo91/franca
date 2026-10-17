import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config/app-config.js';
import { DEFAULT_COST_LIMIT_USD, loadConversationsConfig } from './conversations-config.js';

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConversationsConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('loadConversationsConfig no lanzó');
}

describe('loadConversationsConfig', () => {
  it('sin variables: sin clave y presupuesto de 0.5', () => {
    expect(loadConversationsConfig({})).toEqual({ anthropicApiKey: null, costLimitUsd: 0.5 });
    expect(DEFAULT_COST_LIMIT_USD).toBe(0.5);
  });

  it.each([undefined, ''])('la clave %j da null', (key) => {
    expect(loadConversationsConfig({ FRANCA_ANTHROPIC_API_KEY: key }).anthropicApiKey).toBeNull();
  });

  it('la clave definida se toma tal cual', () => {
    expect(loadConversationsConfig({ FRANCA_ANTHROPIC_API_KEY: ' clave-de-prueba ' }).anthropicApiKey).toBe(' clave-de-prueba ');
  });

  it('ignora las variables del SDK de Anthropic', () => {
    const config = loadConversationsConfig({ ANTHROPIC_API_KEY: 'sk-no-usar', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
    expect(config).toEqual({ anthropicApiKey: null, costLimitUsd: 0.5 });
  });

  it.each([
    ['0.01', 0.01],
    ['1000', 1000],
    ['.5', 0.5],
    ['5.', 5],
    ['2', 2],
    ['0.5', 0.5],
    ['000.250', 0.25],
  ])('admite el presupuesto %j', (value, expected) => {
    expect(loadConversationsConfig({ FRANCA_CONVERSATION_COST_LIMIT_USD: value }).costLimitUsd).toBe(expected);
  });

  it.each(['abc', '0', '0.0', '-1', '1e3', '1001', '1000.01', '', ' 1', '1 ', '.', '1.2.3', '+1', '1,5', '0x10', '1\n', '9'.repeat(400)])(
    'rechaza el presupuesto %j, nombra la variable y no repite el valor',
    (value) => {
      const error = failure({ FRANCA_CONVERSATION_COST_LIMIT_USD: value });
      expect(error.message).toContain('FRANCA_CONVERSATION_COST_LIMIT_USD');
      // El mensaje es el mismo para cualquier valor rechazado: no puede repetir el que recibió.
      expect(error.message).toBe(failure({ FRANCA_CONVERSATION_COST_LIMIT_USD: 'valor-distinto' }).message);
    },
  );

  it('un presupuesto inválido no se salva por tener clave', () => {
    expect(failure({ FRANCA_ANTHROPIC_API_KEY: 'clave-de-prueba', FRANCA_CONVERSATION_COST_LIMIT_USD: 'abc' }).message).not.toContain('clave-de-prueba');
  });
});
