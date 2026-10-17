import { afterEach, describe, expect, it } from 'vitest';
import { startApi, type RunningApi } from './helpers/process.js';

// Una base inexistente: la conexión es perezosa y estas pruebas no usan la base.
const FAKE_DATABASE_URL = 'postgresql://usuario:no-mostrar-1234@127.0.0.1:59999/franca';
const NAMES = 'FRANCA_HTTP_LOCAL_NAMES';
const DESTINATIONS = 'FRANCA_HTTP_ALLOWED_DESTINATIONS';

describe('salida http: arranque con nombres locales (proceso real, e2e)', () => {
  const running: RunningApi[] = [];
  const start = (variables: Record<string, string>): RunningApi => {
    const api = startApi({ DATABASE_URL: FAKE_DATABASE_URL, PORT: '0', ...variables });
    running.push(api);
    return api;
  };

  afterEach(async () => {
    await Promise.all(running.splice(0).map((api) => api.stop()));
  });

  /** Cada valor por separado y en paralelo: ninguno llega a escuchar, todos terminan con error y nombran la variable. */
  async function expectNeverListens(values: string[]): Promise<void> {
    const apis = values.map((value) => start({ [NAMES]: value }));
    const codes = await Promise.all(apis.map((api) => api.exited));
    apis.forEach((api, index) => {
      const label = JSON.stringify(values[index]);
      expect(codes[index], label).not.toBe(0);
      expect(codes[index], label).not.toBeNull();
      expect(api.listening(), label).toBeUndefined();
      expect(api.output(), label).toContain(NAMES);
      expect(api.output(), label).not.toContain('escuchando');
      expect(api.output(), label).not.toContain('no-mostrar-1234');
    });
  }

  it('Nombres locales no admitidos', async () => {
    await expectNeverListens([
      'crm.franca.test',
      'crm.franca.test=',
      '=127.0.0.1',
      'CRM.franca.test=127.0.0.1',
      'crm.example.com=127.0.0.1',
      'crm.franca.test.=127.0.0.1',
      'test=127.0.0.1',
      'localhost=127.0.0.1',
      'crm.localhost=127.0.0.1',
      'crm.franca.test=10.0.0.5',
      'crm.franca.test=1.2.3.4',
      'crm.franca.test=127.000.0.1',
      'crm.franca.test=127.0.0.1:4010',
      'crm.franca.test=::1',
      'crm.franca.test=[::2]',
      'crm.franca.test=[0:0:0:0:0:0:0:1]',
      'crm.franca.test=[::ffff:127.0.0.1]',
      'crm.franca.test=localhost',
      'crm.franca.test=127.0.0.1, otro.franca.test=127.0.0.1',
    ]);
    const api = start({ [NAMES]: 'crm.franca.test=127.0.0.1,crm.franca.test=[::1],soporte.franca.test=127.0.0.2' });
    expect(await api.whenListening()).toBeDefined();
  });

  it('Entradas vacías en los nombres locales', async () => {
    await expectNeverListens(['crm.franca.test=127.0.0.1,', ',crm.franca.test=127.0.0.1', 'crm.franca.test=127.0.0.1,,otro.franca.test=127.0.0.1', ',', ' ']);
    const api = start({ [NAMES]: '' });
    expect(await api.whenListening()).toBeDefined();
    expect(api.output()).toContain('nombres locales: ninguno');
  });

  it('Salida de arranque con nombres locales', async () => {
    const api = start({ [NAMES]: 'crm.franca.test=127.0.0.1,crm.franca.test=[::1]', [DESTINATIONS]: '127.0.0.1:4010' });
    expect(await api.whenListening()).toBeDefined();
    await api.stop();
    const line = api.output().split('\n').find((candidate) => candidate.includes('127.0.0.1:4010'));
    expect(line).toBeDefined();
    // El orden se busca a partir de la posición del nombre: 127.0.0.1 ya aparece antes, en el par permitido.
    const name = line!.indexOf('crm.franca.test');
    expect(name).toBeGreaterThan(-1);
    const v4 = line!.indexOf('127.0.0.1', name);
    expect(v4).toBeGreaterThan(name);
    expect(line!.indexOf('[::1]', v4)).toBeGreaterThan(v4);

    const without = start({ [DESTINATIONS]: '127.0.0.1:4010' });
    expect(await without.whenListening()).toBeDefined();
    await without.stop();
    const plain = without.output().split('\n').find((candidate) => candidate.includes('127.0.0.1:4010'));
    expect(plain).toContain('nombres locales: ninguno');
  });
});
