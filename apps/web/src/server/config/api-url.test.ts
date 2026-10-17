import { describe, expect, it } from 'vitest';
import { ApiUrlError, DEFAULT_API_URL, parseApiUrl } from '@/server/config/api-url.mjs';

describe('parseApiUrl', () => {
  it('sin la variable vale el valor por defecto', () => {
    expect(DEFAULT_API_URL).toBe('http://127.0.0.1:3001');
    expect(parseApiUrl(undefined)).toEqual({ hostHeader: '127.0.0.1:3001', address: '127.0.0.1', family: 4, port: 3001 });
  });

  it('admite localhost, 127.0.0.1 y [::1] con y sin puerto, y una barra final', () => {
    expect(parseApiUrl('http://localhost:3001')).toEqual({ hostHeader: 'localhost:3001', address: 'localhost', family: 'loopback', port: 3001 });
    expect(parseApiUrl('http://[::1]:3001')).toEqual({ hostHeader: '[::1]:3001', address: '::1', family: 6, port: 3001 });
    expect(parseApiUrl('http://127.0.0.1')).toEqual({ hostHeader: '127.0.0.1', address: '127.0.0.1', family: 4, port: 80 });
    expect(parseApiUrl('http://127.0.0.1:3001/').port).toBe(3001);
  });

  it('las mayúsculas del esquema y del nombre no cambian el destino', () => {
    expect(parseApiUrl('HTTP://LOCALHOST:3001')).toEqual(parseApiUrl('http://localhost:3001'));
  });

  it.each([
    'https://127.0.0.1:3001',
    'http://api.example.com:3001',
    'http://127.0.0.1:3001/v1',
    'http://u:p@127.0.0.1:3001',
    'http://@127.0.0.1:3001',
    '127.0.0.1:3001',
    '',
    'http://127.0.0.1:3001?x=1',
    'http://127.0.0.1:3001?',
    'http://127.0.0.1:3001#',
    'http://127.0.0.1:3001#a',
    'http://127.0.0.1:0',
    'http://127.0.0.1:99999',
    'http://0.0.0.0:3001',
    'http://localhost.evil.example:3001',
    'http://127.0.0.1.nip.io:3001',
    'http://127.0.0.1:3001\\',
    'http://127.0.0.1:3001//',
    ' http://127.0.0.1:3001',
    'http://127.0.0.1:3001 ',
    'http://127.0.0.1:\t3001',
    'http://127.0.0.1:3001\n',
    'http://127.0.0.1\n:3001',
    'http://１２７．０．０．１:3001',
    'ftp://127.0.0.1:3001',
    'http://[::2]:3001',
  ])('rechaza %j', (value) => {
    expect(() => parseApiUrl(value)).toThrow(ApiUrlError);
  });

  it('el mensaje nombra FRANCA_API_URL y nunca repite el valor', () => {
    for (const secret of ['http://api.example.com:3001', 'http://u:clave-secreta@127.0.0.1:3001', 'https://127.0.0.1:3001']) {
      let message = '';
      try {
        parseApiUrl(secret);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('FRANCA_API_URL');
      expect(message).not.toContain('api.example.com');
      expect(message).not.toContain('clave-secreta');
      expect(message).not.toContain(secret);
    }
  });
});
