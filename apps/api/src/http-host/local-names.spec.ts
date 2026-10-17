import { Socket } from 'node:net';
import type { HttpRequest } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config/app-config.js';
import { createAllowedDestinations } from './destination-policy.js';
import { describeHttpHostConfig, loadHttpHostConfig } from './http-host-config.js';
import { createHttpHost } from './http-host.js';
import { createLocalNames, describeLocalNames, LOCAL_NAMES_VARIABLE, readLocalNames } from './local-names.js';
import type { HttpNetwork } from './network.js';
import { createSecretStore } from './secrets.js';

async function rejection(value: string): Promise<ConfigError> {
  try {
    await readLocalNames(value);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error(`«${value}» debía impedir arrancar`);
}

describe('readLocalNames', () => {
  const unsupported = [
    'crm.franca.test',
    'crm.franca.test=',
    '=127.0.0.1',
    'CRM.franca.test=127.0.0.1',
    'crm.example.com=127.0.0.1',
    'crm.franca.test.=127.0.0.1',
    'test=127.0.0.1',
    '.test=127.0.0.1',
    'localhost=127.0.0.1',
    'crm.localhost=127.0.0.1',
    'crm.franca.test=10.0.0.5',
    'crm.franca.test=1.2.3.4',
    'crm.franca.test=127.000.0.1',
    'crm.franca.test=127.0.0.256',
    'crm.franca.test=127.0.0.1:4010',
    'crm.franca.test=::1',
    'crm.franca.test=[::2]',
    'crm.franca.test=[0:0:0:0:0:0:0:1]',
    'crm.franca.test=[::ffff:127.0.0.1]',
    'crm.franca.test=localhost',
    'crm.franca.test:4010=127.0.0.1',
    'crm.franca.test/x=127.0.0.1',
    'crm.franca.test=127.0.0.1, otro.franca.test=127.0.0.1',
    ' ',
  ];

  it.each(unsupported)('«%s» da un ConfigError que nombra la variable y no repite el valor', async (value) => {
    const error = await rejection(value);
    expect(error.message).toContain(LOCAL_NAMES_VARIABLE);
    expect(error.message).toContain('nº ');
    // Un valor solo de blancos está en cualquier mensaje por los espacios del texto; el resto no puede repetirse.
    expect(error.message.includes(value) && value.trim() !== '').toBe(false);
  });

  it.each([',', 'crm.franca.test=127.0.0.1,', ',crm.franca.test=127.0.0.1', 'crm.franca.test=127.0.0.1,,otro.franca.test=127.0.0.1'])(
    'la entrada vacía de «%s» da un ConfigError que la señala',
    async (value) => {
      const error = await rejection(value);
      expect(error.message).toContain(LOCAL_NAMES_VARIABLE);
      expect(error.message).toContain('vacía');
    },
  );

  it('el mensaje dice la posición de la entrada mala', async () => {
    expect((await rejection('crm.franca.test=127.0.0.1,mal')).message).toContain('nº 2');
    expect((await rejection('crm.franca.test=127.0.0.1,a.franca.test=8.8.8.8')).message).toContain('nº 2 debe llevar una dirección de loopback');
  });

  it.each([undefined, ''])('«%s» no da nombres locales', async (value) => {
    expect(await readLocalNames(value)).toEqual([]);
  });

  it('agrupa por nombre, por orden de primera aparición y con las direcciones en el orden escrito', async () => {
    const entries = await readLocalNames('crm.franca.test=127.0.0.1,crm.franca.test=[::1],soporte.franca.test=127.0.0.2');
    expect(entries).toEqual([
      {
        name: 'crm.franca.test',
        addresses: [
          { display: '127.0.0.1', address: '127.0.0.1', family: 4 },
          { display: '[::1]', address: '::1', family: 6 },
        ],
      },
      { name: 'soporte.franca.test', addresses: [{ display: '127.0.0.2', address: '127.0.0.2', family: 4 }] },
    ]);
  });

  it('admite todo el rango 127.0.0.0/8 y no quita repetidos', async () => {
    const entries = await readLocalNames('a.test=127.255.255.255,a.test=127.0.0.0,a.test=127.0.0.0');
    expect(entries[0]!.addresses.map((address) => address.display)).toEqual(['127.255.255.255', '127.0.0.0', '127.0.0.0']);
  });

  it('separa por la primera «=» de cada entrada', async () => {
    const error = await rejection('crm.franca.test=127.0.0.1=1');
    expect(error.message).toContain('dirección de loopback');
  });
});

describe('createLocalNames', () => {
  it('la búsqueda es exacta y conserva el orden', async () => {
    const names = createLocalNames(await readLocalNames('crm.franca.test=[::1],crm.franca.test=127.0.0.1'));
    expect(names.lookup('crm.franca.test')).toEqual([
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ]);
    for (const other of ['otro.franca.test', 'crm.franca.test.', 'CRM.franca.test', 'franca.test', 'crm.franca.test:4010', '']) {
      expect(names.lookup(other)).toBeUndefined();
    }
  });

  it('sin entradas no encuentra nada', () => {
    expect(createLocalNames([]).lookup('crm.franca.test')).toBeUndefined();
  });
});

describe('línea de arranque con nombres locales', () => {
  it('sin nombres locales dice ninguno', async () => {
    expect(describeLocalNames([])).toBe('ninguno');
    expect(describeHttpHostConfig(await loadHttpHostConfig({}))).toBe(
      'salida http: secretos ninguno; variables ignoradas: ninguna; destinos permitidos: ninguno; nombres locales: ninguno',
    );
  });

  it('con la configuración de la demo coincide con el contrato', async () => {
    const line = describeHttpHostConfig(
      await loadHttpHostConfig({
        FRANCA_HTTP_LOCAL_NAMES: 'crm.franca.test=127.0.0.1',
        FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:4010',
        FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=http://crm.franca.test:4010',
        FRANCA_SECRET_CRM_TOKEN: 'Bearer prueba-linea',
      }),
    );
    expect(line).toBe(
      'salida http: secretos CRM_TOKEN (http://crm.franca.test:4010); variables ignoradas: ninguna; destinos permitidos: 127.0.0.1:4010; nombres locales: crm.franca.test (127.0.0.1)',
    );
  });

  it('muestra cada nombre con sus direcciones como se escribieron, separados por coma', async () => {
    const line = describeLocalNames(await readLocalNames('crm.franca.test=127.0.0.1,crm.franca.test=[::1],soporte.franca.test=127.0.0.2'));
    expect(line).toBe('crm.franca.test (127.0.0.1, [::1]), soporte.franca.test (127.0.0.2)');
  });
});

interface Spy {
  readonly network: HttpNetwork;
  readonly lookups: string[];
  readonly opens: { address: string; family: 4 | 6; port: number }[];
}

/** Una red sin IO: el resolutor responde una IP pública y el abridor devuelve un socket que falla al momento. */
function spyNetwork(): Spy {
  const lookups: string[] = [];
  const opens: Spy['opens'] = [];
  return {
    lookups,
    opens,
    network: {
      resolver: {
        lookup: async (hostname) => {
          lookups.push(hostname);
          return [{ address: '93.184.216.34', family: 4 }];
        },
      },
      opener: {
        open: (target) => {
          opens.push(target);
          const socket = new Socket();
          socket.destroy(new Error('conexión rechazada del test'));
          return socket;
        },
      },
    },
  };
}

const request = (url: string): HttpRequest => ({
  nodeId: 'enviar',
  method: 'GET',
  url,
  headers: [],
  body: null,
  timeoutMs: 2000,
  attempt: 1,
  containsPii: false,
});

async function hostFor(spy: Spy, allowed: string[]) {
  const blocked: unknown[] = [];
  const capability = createHttpHost({
    secrets: createSecretStore(new Map()),
    allowed: createAllowedDestinations(allowed.map((key) => ({ key }))),
    network: spy.network,
    localNames: createLocalNames(await readLocalNames('crm.franca.test=[::1],crm.franca.test=127.0.0.1')),
    notices: { missingSecret: () => undefined, blocked: (notice) => void blocked.push(notice) },
  }).forAdvance({ conversationId: 'c-1', deadlineMs: 1_090_000, now: () => 1_000_000 });
  return { capability, blocked };
}

describe('createHttpHost con nombres locales', () => {
  it('un nombre local no llama al resolutor y conecta con sus direcciones en el orden escrito', async () => {
    const spy = spyNetwork();
    const { capability } = await hostFor(spy, ['::1|4010', '127.0.0.1|4010']);
    const result = await capability(request('http://crm.franca.test:4010/api/leads'));
    expect(result.kind).toBe('network_error');
    expect(spy.lookups).toEqual([]);
    expect(spy.opens.map((open) => `${open.address}:${open.port}`)).toEqual(['::1:4010', '127.0.0.1:4010']);
  });

  it('sin el par permitido es blocked internal_destination y no abre nada', async () => {
    const spy = spyNetwork();
    const { capability, blocked } = await hostFor(spy, []);
    expect(await capability(request('http://crm.franca.test:4010/'))).toEqual({ kind: 'blocked' });
    expect(spy.opens).toEqual([]);
    expect(spy.lookups).toEqual([]);
    expect(blocked).toEqual([{ conversationId: 'c-1', nodeId: 'enviar', reason: 'internal_destination' }]);
  });

  it('un nombre .test que no es local sí pregunta al resolutor', async () => {
    const spy = spyNetwork();
    const { capability } = await hostFor(spy, ['::1|4010', '127.0.0.1|4010']);
    await capability(request('http://otro.franca.test:4010/'));
    expect(spy.lookups).toEqual(['otro.franca.test']);
  });

  it('sin localNames un nombre .test se resuelve como siempre', async () => {
    const spy = spyNetwork();
    const capability = createHttpHost({
      secrets: createSecretStore(new Map()),
      allowed: createAllowedDestinations([]),
      network: spy.network,
      notices: { missingSecret: () => undefined, blocked: () => undefined },
    }).forAdvance({ conversationId: 'c-1', deadlineMs: 1_090_000, now: () => 1_000_000 });
    await capability(request('http://crm.franca.test:4010/'));
    expect(spy.lookups).toEqual(['crm.franca.test']);
  });
});
