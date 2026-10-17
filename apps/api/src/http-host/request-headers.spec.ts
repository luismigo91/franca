import { describe, expect, it } from 'vitest';
import { buildRequestHeaders, requestPath, type WireHeader } from './request-headers.js';

const build = (url: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', headers: WireHeader[] = [], body: string | null = null) =>
  buildRequestHeaders({ method, url: new URL(url), headers, body });

describe('buildRequestHeaders', () => {
  it('Host, cabeceras del nodo en su orden, valores por defecto, Content-Length y Connection', () => {
    expect(build('https://api.example.com/x', 'POST', [['X-Id', '1'], ['Content-Type', 'application/json']], '{"a": 1}')).toEqual([
      ['Host', 'api.example.com'],
      ['X-Id', '1'],
      ['Content-Type', 'application/json'],
      ['Accept-Encoding', 'gzip, deflate, br'],
      ['User-Agent', 'Franca'],
      ['Content-Length', '8'],
      ['Connection', 'close'],
    ]);
  });

  it('Host lleva el puerto solo si no es el de por defecto', () => {
    expect(build('https://api.example.com/', 'GET')[0]).toEqual(['Host', 'api.example.com']);
    expect(build('https://api.example.com:443/', 'GET')[0]).toEqual(['Host', 'api.example.com']);
    expect(build('https://api.example.com:8443/', 'GET')[0]).toEqual(['Host', 'api.example.com:8443']);
    expect(build('http://api.example.com:80/', 'GET')[0]).toEqual(['Host', 'api.example.com']);
    expect(build('http://api.example.com:8080/', 'GET')[0]).toEqual(['Host', 'api.example.com:8080']);
  });

  it('el nodo sustituye los valores por defecto, sin distinguir mayúsculas, y se respeta su capitalización', () => {
    const headers = build('https://api.example.com/', 'GET', [['user-agent', 'Otro'], ['ACCEPT-ENCODING', 'identity']]);
    expect(headers).toEqual([
      ['Host', 'api.example.com'],
      ['user-agent', 'Otro'],
      ['ACCEPT-ENCODING', 'identity'],
      ['Connection', 'close'],
    ]);
  });

  it('Content-Length cuenta bytes UTF-8, no unidades', () => {
    const length = (body: string) => build('https://a.example.com/', 'POST', [], body).find(([name]) => name === 'Content-Length')![1];
    expect(length('ñ')).toBe('2');
    expect(length('€')).toBe('3');
    expect(length('😀')).toBe('4');
    expect(length('abc')).toBe('3');
  });

  it('POST, PUT y PATCH sin body llevan Content-Length 0; GET y DELETE, ninguno', () => {
    for (const method of ['POST', 'PUT', 'PATCH'] as const) {
      expect(build('https://a.example.com/', method).find(([name]) => name === 'Content-Length'), method).toEqual(['Content-Length', '0']);
    }
    for (const method of ['GET', 'DELETE'] as const) {
      expect(build('https://a.example.com/', method).find(([name]) => name === 'Content-Length'), method).toBeUndefined();
    }
  });

  it('nunca añade cookies ni nada fuera de la lista', () => {
    const names = build('https://a.example.com/', 'POST', [['X-Id', '1']], '{}').map(([name]) => name.toLowerCase());
    expect(names).toEqual(['host', 'x-id', 'accept-encoding', 'user-agent', 'content-length', 'connection']);
  });
});

describe('requestPath', () => {
  it('ruta y consulta', () => {
    expect(requestPath(new URL('https://a.example.com/api/leads?origen=x&b=2'))).toBe('/api/leads?origen=x&b=2');
    expect(requestPath(new URL('https://a.example.com'))).toBe('/');
    expect(requestPath(new URL('https://a.example.com?x=1'))).toBe('/?x=1');
  });
});
