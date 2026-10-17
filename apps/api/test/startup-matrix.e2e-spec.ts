import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { closedPort, SECRET_PASSWORD, urlTo } from './helpers/network.js';
import { startApi, type RunningApi } from './helpers/process.js';
import { rawRequest } from './helpers/raw.js';

const DATABASE_URL = `postgresql://usuario:${SECRET_PASSWORD}@127.0.0.1:59999/franca`;

/** `true` si alguien escucha en `host:port` (1,5 s como mucho). */
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

/**
 * Matriz de `HOST`, `PORT` y `DATABASE_URL` contra el proceso real (`node dist/main.js`): complementa a
 * `startup.e2e-spec.ts` con más formas de la misma entrada, para que ninguna deje la API escuchando donde no debe.
 */
describe('arranque del proceso real: matriz de HOST, PORT y DATABASE_URL (e2e)', () => {
  const running: RunningApi[] = [];
  const start = (env: Record<string, string>) => {
    const api = startApi(env);
    running.push(api);
    return api;
  };

  afterEach(async () => {
    await Promise.all(running.splice(0).map((api) => api.stop()));
  });

  /** Debe terminar con error, nombrar la variable, no escuchar y no repetir el valor. */
  async function expectRejected(env: Record<string, string>, variable: 'HOST' | 'PORT', value: string): Promise<void> {
    const api = start(env);
    const code = await api.exited;
    expect(code, `HOST/PORT ${JSON.stringify(value)} debía rechazarse`).not.toBe(0);
    expect(code).not.toBeNull();
    expect(api.listening()).toBeUndefined();
    expect(api.output()).toContain(variable);
    expect(api.output()).not.toContain(SECRET_PASSWORD);
    const visible = value.trim();
    if (visible) expect(api.output()).not.toContain(visible);
  }

  it('rechaza cualquier HOST que no sea el texto exacto de un bucle local', async () => {
    const hosts = [
      ' ',
      '127.0.0.1 ',
      '127.0.0.1\n',
      'LOCALHOST',
      '[::1]',
      '0:0:0:0:0:0:0:1',
      '127.000.000.001',
      '127.1',
      '127.0.0.2',
      '127.0.0.1:3000',
      '::1%lo0',
      '0',
      '*',
      'true',
    ];
    await Promise.all(hosts.map((host) => expectRejected({ DATABASE_URL, PORT: '0', HOST: host }, 'HOST', host)));
  });

  it('rechaza cualquier PORT que no sea un entero decimal de 0 a 65535 sin espacios', async () => {
    const ports = ['3001 ', '+3001', '3.0', '-1', '65536', '100000', '999999', '99999999999999999999', '0x50', '1e3', '٣٠٠١', 'NaN', '3001\n', '0000000'];
    await Promise.all(ports.map((port) => expectRejected({ DATABASE_URL, PORT: port }, 'PORT', port)));
  });

  it('con HOST 127.0.0.1 escucha solo en IPv4 de bucle local', async () => {
    const v4 = start({ DATABASE_URL, PORT: '0', HOST: '127.0.0.1' });
    const address = await v4.whenListening();
    expect(address?.host).toBe('127.0.0.1');
    expect(await canConnect('127.0.0.1', address!.port)).toBe(true);
    expect(await canConnect('::1', address!.port)).toBe(false);
  });

  it('un DATABASE_URL roto o con credenciales equivocadas no sale ni en la respuesta ni en la salida', async () => {
    const real = new URL(process.env.DATABASE_URL ?? urlTo(await closedPort()));
    const unknownUser = new URL(real);
    unknownUser.username = 'usuario-que-no-existe';
    unknownUser.password = SECRET_PASSWORD;
    const unknownDatabase = new URL(real);
    unknownDatabase.password = SECRET_PASSWORD;
    unknownDatabase.pathname = '/base_que_no_existe';
    const urls = [
      `no es una url ${SECRET_PASSWORD}`,
      `postgresql://franca:${SECRET_PASSWORD}@127.0.0.1:notaport/franca`,
      `postgresql://franca:${SECRET_PASSWORD}@127.0.0.1:5432/franca?sslmode=bogus`,
      `postgresql://franca:${SECRET_PASSWORD}@nombre-que-no-resuelve.invalid:5432/franca`,
      `mysql://franca:${SECRET_PASSWORD}@127.0.0.1:3306/franca`,
      unknownUser.toString(),
      unknownDatabase.toString(),
    ];
    for (const url of urls) {
      const api = start({ DATABASE_URL: url, PORT: '0' });
      const address = await api.whenListening();
      expect(address, 'la API arranca aunque la base no responda: la conexión es perezosa').toBeDefined();
      const list = await rawRequest(address!.port, { path: '/flows' });
      const create = await rawRequest(address!.port, {
        method: 'POST',
        path: '/flows',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specVersion: '0.1', id: 'hola', name: 'Hola', start: 'fin', nodes: [{ id: 'fin', type: 'end' }] }),
      });
      // 503 si la base no responde; 500 si responde que no (usuario o base inexistentes). Nunca el valor.
      for (const res of [list, create]) {
        expect([500, 503]).toContain(res.status);
        expect(Object.keys(res.json)).toEqual(['message', 'error']);
        expect(res.text).not.toContain(SECRET_PASSWORD);
        expect(res.text).not.toContain('usuario-que-no-existe');
        expect(res.text).not.toContain('base_que_no_existe');
      }
      await api.stop();
      expect(api.output(), `salida con ${url.slice(0, 20)}`).not.toContain(SECRET_PASSWORD);
      expect(api.output()).not.toContain('usuario-que-no-existe');
      expect(api.output()).not.toContain('base_que_no_existe');
    }
  }, 60_000);
});
