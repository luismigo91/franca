import type * as dns from 'node:dns';
import type * as net from 'node:net';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemNetwork, LOOKUP_OPTIONS, systemNetwork } from './network.js';

afterEach(() => vi.unstubAllEnvs());

describe('createSystemNetwork', () => {
  const answers = [
    { address: '::1', family: 6 },
    { address: '127.0.0.1', family: 4 },
  ];

  it('lookup recibe exactamente LOOKUP_OPTIONS y su resultado, de dos familias, llega intacto y en orden', async () => {
    const lookup = vi.fn(async (_hostname: string, _options: unknown) => answers);
    const network = createSystemNetwork({ lookup: lookup as unknown as typeof dns.promises.lookup, connect: vi.fn() as unknown as typeof net.connect });
    const result = await network.resolver.lookup('crm.example.com');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]).toStrictEqual(['crm.example.com', { all: true, order: 'verbatim' }]);
    expect(lookup.mock.calls[0]![1]).toBe(LOOKUP_OPTIONS);
    expect(result).toBe(answers);
    expect(LOOKUP_OPTIONS).toStrictEqual({ all: true, order: 'verbatim' });
  });

  it('un rechazo del resolutor llega tal cual (la lógica está en http-host)', async () => {
    const failure = new Error('ENOTFOUND');
    const network = createSystemNetwork({ lookup: (async () => Promise.reject(failure)) as unknown as typeof dns.promises.lookup, connect: vi.fn() as unknown as typeof net.connect });
    await expect(network.resolver.lookup('x.example.com')).rejects.toBe(failure);
  });

  it('connect recibe la IP, el puerto, la familia, autoSelectFamily false y un lookup que falla; el socket llega tal cual', async () => {
    const socket = new Socket();
    const connect = vi.fn(() => socket);
    const network = createSystemNetwork({ lookup: vi.fn() as unknown as typeof dns.promises.lookup, connect: connect as unknown as typeof net.connect });
    expect(network.opener.open({ address: '2606:4700::1111', family: 6, port: 8443 })).toBe(socket);
    expect(connect).toHaveBeenCalledTimes(1);
    const options = (connect.mock.calls[0] as unknown as [net.TcpNetConnectOpts])[0];
    expect(options).toMatchObject({ host: '2606:4700::1111', port: 8443, family: 6, autoSelectFamily: false, noDelay: true });
    expect(Object.keys(options).sort()).toEqual(['autoSelectFamily', 'family', 'host', 'lookup', 'noDelay', 'port']);
    const outcome = await new Promise<unknown>((resolve) => (options.lookup as (...args: unknown[]) => void)('otro.example.com', {}, (error: unknown) => resolve(error)));
    expect(outcome).toBeInstanceOf(Error);
  });
});

describe('systemNetwork', () => {
  it('no lee el entorno: con todas las variables de TLS y proxy definidas no tiene autoridades propias ni nada más', () => {
    for (const name of ['NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'SSL_CERT_FILE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_USE_ENV_PROXY']) {
      vi.stubEnv(name, name.includes('PROXY') || name.includes('proxy') ? 'http://127.0.0.1:9' : '0');
    }
    const network = systemNetwork();
    expect(network.ca).toBeUndefined();
    expect(Object.keys(network).sort()).toEqual(['opener', 'resolver']);
  });

  it('el resolutor de producción devuelve todas las direcciones (all: true)', async () => {
    const answers = await systemNetwork().resolver.lookup('localhost');
    expect(Array.isArray(answers)).toBe(true);
    expect(answers.length).toBeGreaterThan(0);
  });
});
