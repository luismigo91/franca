import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { closedPort, SECRET_PASSWORD, urlTo } from './helpers/network.js';
import { startApi, type RunningApi } from './helpers/process.js';
import { rawRequest } from './helpers/raw.js';

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

  it('Dirección pública rechazada', async () => {
    // Cada valor por separado, en paralelo: ninguno llega a escuchar y todos terminan con error nombrando HOST.
    const hosts = ['0.0.0.0', '::', '192.168.1.10', '::ffff:127.0.0.1', 'localhost', '', ' 127.0.0.1'];
    await Promise.all(hosts.map((host) => expectRejected({ DATABASE_URL, PORT: '0', HOST: host }, 'HOST', host === '' ? undefined : host)));
  });

  it('Loopback IPv6', { skip: !HAS_IPV6_LOOPBACK }, async () => {
    const api = start({ DATABASE_URL, PORT: '0', HOST: '::1' });
    const address = await api.whenListening();
    expect(address?.host).toBe('[::1]');
    expect(await canConnect('::1', address!.port)).toBe(true);
    expect(await canConnect('127.0.0.1', address!.port)).toBe(false);
  });

  it('Puerto no válido', async () => {
    const ports = ['abc', '70000', '', ' 3001'];
    await Promise.all(ports.map((port) => expectRejected({ DATABASE_URL, PORT: port }, 'PORT', port === '' ? undefined : port)));
  });

  it('Falta la variable', async () => {
    await expectRejected({ PORT: '0' }, 'DATABASE_URL');
  });

  it('El valor no aparece al fallar la conexión', async () => {
    const port = await closedPort();
    const api = start({ DATABASE_URL: urlTo(port), PORT: '0' });
    const address = await api.whenListening();
    expect(address).toBeDefined();

    const res = await rawRequest(address!.port, { path: '/flows' });
    expect(res.status).toBe(503);
    expect(res.json).toEqual({ message: expect.any(String), error: 'database_unavailable' });
    expect(res.text).not.toContain(SECRET_PASSWORD);

    await api.stop();
    expect(api.output()).not.toContain(SECRET_PASSWORD);
    expect(api.output()).not.toContain(`127.0.0.1:${port}`);
    // El registro del 503 existe y solo lleva método, ruta, estado y código.
    expect(api.output()).toContain('GET /flows 503 database_unavailable');
  });
});
