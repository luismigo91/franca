import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startApi, type RunningApi } from './helpers/process.js';

const DATABASE_URL = 'postgresql://usuario:no-mostrar-1234@127.0.0.1:59999/franca';
const HAS_IPV6_LOOPBACK = Object.values(networkInterfaces()).some((list) => list?.some((entry) => entry.address === '::1'));

/** Intenta conectar a `host:port` (1,5 s como mucho); `true` si hay alguien escuchando. */
function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1500 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('arranque del proceso real', () => {
  const running: RunningApi[] = [];
  const start = (env: Record<string, string>) => {
    const api = startApi(env);
    running.push(api);
    return api;
  };

  afterEach(async () => {
    await Promise.all(running.splice(0).map((api) => api.stop()));
  });

  /** Arranca con una configuración que debe rechazarse y comprueba la salida con error. */
  async function expectRejected(env: Record<string, string>, variable: string, rejectedValue?: string): Promise<void> {
    const api = start(env);
    const code = await api.exited;
    expect(code).not.toBe(0);
    expect(code).not.toBeNull();
    expect(api.listening()).toBeUndefined();
    expect(api.output()).toContain(variable);
    expect(api.output()).not.toContain('no-mostrar-1234');
    if (rejectedValue) expect(api.output()).not.toContain(rejectedValue);
  }

  it('Arranque por defecto', async () => {
    const api = start({ DATABASE_URL, PORT: '0' });
    const address = await api.whenListening();
    expect(address?.host).toBe('127.0.0.1');
    expect(await canConnect('127.0.0.1', address!.port)).toBe(true);
    // Solo esa dirección: ni IPv6 de bucle local ni ninguna otra interfaz.
    expect(await canConnect('::1', address!.port)).toBe(false);
    // Direcciones de las demás interfaces (las de enlace local de IPv6 necesitan un ámbito que `connect` no da).
    for (const entry of Object.values(networkInterfaces()).flat()) {
      if (entry && !entry.internal && !entry.address.startsWith('fe80:')) {
        expect(await canConnect(entry.address, address!.port), 'interfaz con una dirección que no es de bucle local').toBe(false);
      }
    }
  });

  it.each(['', ' 127.0.0.1', '::ffff:127.0.0.1', '0.0.0.0', '::', '192.168.1.10', 'localhost'])(
    'Dirección pública rechazada: HOST %j',
    async (host) => {
      await expectRejected({ DATABASE_URL, PORT: '0', HOST: host }, 'HOST', host === '' ? undefined : host);
    },
  );

  it.skipIf(!HAS_IPV6_LOOPBACK)('Loopback IPv6', async () => {
    const api = start({ DATABASE_URL, PORT: '0', HOST: '::1' });
    const address = await api.whenListening();
    expect(address?.host).toBe('[::1]');
    expect(await canConnect('::1', address!.port)).toBe(true);
    expect(await canConnect('127.0.0.1', address!.port)).toBe(false);
  });

  it.each(['abc', '70000', '', ' 3001'])('Puerto no válido: PORT %j', async (port) => {
    await expectRejected({ DATABASE_URL, PORT: port }, 'PORT', port === '' ? undefined : port);
  });

  it('Falta la variable', async () => {
    await expectRejected({ PORT: '0' }, 'DATABASE_URL');
  });
});
