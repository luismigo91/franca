import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './app-config.js';

const DATABASE_URL = 'postgresql://usuario:no-mostrar-1234@127.0.0.1:5432/franca';

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('loadConfig no lanzó');
}

describe('loadConfig', () => {
  it('HOST y PORT ausentes dan 127.0.0.1 y 3001', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({ host: '127.0.0.1', port: 3001, databaseUrl: DATABASE_URL });
  });

  it.each(['127.0.0.1', '::1'])('admite HOST %s', (host) => {
    expect(loadConfig({ DATABASE_URL, HOST: host }).host).toBe(host);
  });

  it.each(['', ' 127.0.0.1', '::ffff:127.0.0.1', '0.0.0.0', '::', '192.168.1.10', 'localhost'])(
    'rechaza HOST %j, nombra la variable y no repite el valor',
    (host) => {
      const error = failure({ DATABASE_URL, HOST: host });
      expect(error.message).toContain('HOST');
      expect(error.message).toContain('autenticación');
      if (host !== '') expect(error.message).not.toContain(host);
    },
  );

  it.each([
    ['0', 0],
    ['3001', 3001],
    ['65535', 65535],
  ])('admite PORT %s', (port, expected) => {
    expect(loadConfig({ DATABASE_URL, PORT: port }).port).toBe(expected);
  });

  it.each(['', ' 3001', '3001 ', 'abc', '70000', '65536', '-1', '1.5', '123456', '0x10'])(
    'rechaza PORT %j, nombra la variable y no repite el valor',
    (port) => {
      const error = failure({ DATABASE_URL, PORT: port });
      expect(error.message).toContain('PORT');
      if (port !== '') expect(error.message).not.toContain(port);
    },
  );

  it.each([undefined, ''])('rechaza DATABASE_URL %j y nombra la variable', (value) => {
    expect(failure({ DATABASE_URL: value }).message).toContain('DATABASE_URL');
  });

  it('ningún mensaje contiene la cadena de conexión', () => {
    expect(failure({ DATABASE_URL, HOST: '0.0.0.0' }).message).not.toContain('no-mostrar-1234');
    expect(failure({ DATABASE_URL, PORT: 'abc' }).message).not.toContain('no-mostrar-1234');
  });

  it('comprueba HOST antes que PORT y que DATABASE_URL', () => {
    expect(failure({ HOST: '0.0.0.0', PORT: 'abc' }).message).toContain('HOST');
    expect(failure({ PORT: 'abc' }).message).toContain('PORT');
  });
});
