import { afterEach, describe, expect, it } from 'vitest';
import { startApi, type RunningApi } from './helpers/process.js';

// Una base inexistente: la conexión es perezosa y estas pruebas no usan la base.
const FAKE_DATABASE_URL = 'postgresql://usuario:no-mostrar-1234@127.0.0.1:59999/franca';
const ORIGINS = 'FRANCA_HTTP_SECRET_ORIGINS';
const DESTINATIONS = 'FRANCA_HTTP_ALLOWED_DESTINATIONS';
const SECRET = 'FRANCA_SECRET_CRM_TOKEN';
const MARKER = 'no-mostrar-1';

describe('salida http: arranque del proceso real (e2e)', () => {
  const running: RunningApi[] = [];
  const start = (variables: Record<string, string>): RunningApi => {
    const api = startApi({ DATABASE_URL: FAKE_DATABASE_URL, PORT: '0', ...variables });
    running.push(api);
    return api;
  };

  afterEach(async () => {
    await Promise.all(running.splice(0).map((api) => api.stop()));
  });

  /** Cada configuración por separado y en paralelo: ninguna llega a escuchar, todas terminan con error y nombran `variable`. */
  async function expectNeverListens(configurations: Record<string, string>[], variable: string, forbidden: string[] = []): Promise<void> {
    const apis = configurations.map(start);
    const codes = await Promise.all(apis.map((api) => api.exited));
    apis.forEach((api, index) => {
      const label = JSON.stringify(configurations[index]).slice(0, 120);
      expect(codes[index], label).not.toBe(0);
      expect(codes[index], label).not.toBeNull();
      expect(api.listening(), label).toBeUndefined();
      expect(api.output(), label).toContain(variable);
      expect(api.output(), label).not.toContain('escuchando');
      expect(api.output(), label).not.toContain('no-mostrar-1234');
      for (const value of forbidden) expect(api.output(), label).not.toContain(value);
    });
  }

  it('Orígenes de secretos no admitidos', async () => {
    const invalid = [
      'CRM_TOKEN',
      'crm_token=https://crm.example.com',
      'CRM_TOKEN=https://crm.example.com/',
      'CRM_TOKEN=https://crm.example.com:443',
      'CRM_TOKEN=HTTPS://crm.example.com',
      'CRM_TOKEN=ftp://crm.example.com',
      'CRM_TOKEN=https://1.2.3.4',
      'CRM_TOKEN=http://localhost:8080',
      'CRM_TOKEN=https://crm.example.com, CRM_TOKEN=https://x.example.com',
    ];
    await expectNeverListens(
      invalid.map((origins) => ({ [SECRET]: 'Bearer x', [ORIGINS]: origins })),
      ORIGINS,
    );
  });

  it('Entradas vacías en los orígenes', async () => {
    const empties = ['CRM_TOKEN=https://crm.example.com,', ',CRM_TOKEN=https://crm.example.com', 'CRM_TOKEN=https://crm.example.com,,CRM_TOKEN=https://crm.example.com:8443', ',', ' '];
    await expectNeverListens(
      empties.map((origins) => ({ [SECRET]: 'Bearer x', [ORIGINS]: origins })),
      ORIGINS,
    );
    const api = start({ [SECRET]: 'Bearer x', [ORIGINS]: '' });
    expect(await api.whenListening()).toBeDefined();
    expect(api.output()).toContain('secretos ninguno');
  });

  it('Valores de secreto no admitidos', async () => {
    const withOrigins = { [ORIGINS]: 'CRM_TOKEN=https://crm.example.com' };
    const invalid: Record<string, string>[] = [
      {},
      { [SECRET]: '' },
      { [SECRET]: ` Bearer ${MARKER}` },
      { [SECRET]: `Bearer ${MARKER}\n` },
      { [SECRET]: `Bearer ñ-${MARKER}` },
      { [SECRET]: 'a'.repeat(8193) },
    ];
    await expectNeverListens(
      invalid.map((secret) => ({ ...withOrigins, ...secret })),
      SECRET,
      [MARKER],
    );
    for (const value of ['Bearer x', 'a'.repeat(8192)]) {
      const api = start({ ...withOrigins, [SECRET]: value });
      expect(await api.whenListening(), `${value.length} caracteres`).toBeDefined();
    }
  });

  it('Destinos permitidos no admitidos', async () => {
    const invalid = ['localhost:8080', '127.0.0.1', '127.0.0.1:0', '127.0.0.1:65536', '127.0.0.1:08080', '127.0.0.01:8080', '::1:8080', '10.0.0.0/8:80', '*:80', '127.0.0.1:8080, 127.0.0.2:8080'];
    await expectNeverListens(
      invalid.map((destinations) => ({ [DESTINATIONS]: destinations })),
      DESTINATIONS,
    );
    const api = start({ [DESTINATIONS]: '127.0.0.1:8080,[::1]:8443' });
    expect(await api.whenListening()).toBeDefined();
  });

  it('Entradas vacías en los destinos permitidos', async () => {
    const empties = ['127.0.0.1:8080,', ',127.0.0.1:8080', '127.0.0.1:8080,,[::1]:8443', ',', ' '];
    await expectNeverListens(
      empties.map((destinations) => ({ [DESTINATIONS]: destinations })),
      DESTINATIONS,
    );
    const api = start({ [DESTINATIONS]: '' });
    expect(await api.whenListening()).toBeDefined();
    expect(api.output()).toContain('destinos permitidos: ninguno');
  });

  it('Salida de arranque de la salida http', async () => {
    const api = start({ [SECRET]: 'Bearer prueba-crm-1', [ORIGINS]: 'CRM_TOKEN=https://crm.example.com', [DESTINATIONS]: '127.0.0.1:8080', FRANCA_SECRET_SOPORTE_TOKEN: 'Bearer no-mostrar-2' });
    expect(await api.whenListening()).toBeDefined();
    await api.stop();
    const line = api.output().split('\n').find((candidate) => candidate.includes('salida http:'));
    expect(line).toBeDefined();
    for (const part of ['CRM_TOKEN', 'https://crm.example.com', '127.0.0.1:8080', 'FRANCA_SECRET_SOPORTE_TOKEN']) expect(line, part).toContain(part);
    expect(api.output()).not.toContain('prueba-crm-1');
    expect(api.output()).not.toContain('no-mostrar-2');
  });
});
