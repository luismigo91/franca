import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config/app-config.js';
import { describeHttpHostConfig, loadHttpHostConfig, SECRET_NAME } from './http-host-config.js';
import { isNodeUrlOrigin } from './secret-origin.js';
import { createSecretStore } from './secrets.js';

const MARKER = 'no-mostrar-1';

const rejection = async (env: Record<string, string | undefined>): Promise<ConfigError> => {
  try {
    await loadHttpHostConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error(`se esperaba un ConfigError con ${JSON.stringify(env)}`);
};

const withOrigins = (origins: string, extra: Record<string, string> = { FRANCA_SECRET_CRM_TOKEN: 'Bearer x' }) => ({ FRANCA_HTTP_SECRET_ORIGINS: origins, ...extra });

describe('FRANCA_HTTP_SECRET_ORIGINS', () => {
  it('ausente o vacía: sin secretos', async () => {
    expect((await loadHttpHostConfig({})).secrets.size).toBe(0);
    expect((await loadHttpHostConfig({ FRANCA_HTTP_SECRET_ORIGINS: '' })).secrets.size).toBe(0);
  });

  it('un origen, dos orígenes para un nombre y una entrada repetida cargan', async () => {
    const one = await loadHttpHostConfig(withOrigins('CRM_TOKEN=https://crm.example.com'));
    expect([...one.secrets.keys()]).toEqual(['CRM_TOKEN']);
    expect([...one.secrets.get('CRM_TOKEN')!.origins]).toEqual(['https://crm.example.com']);
    const two = await loadHttpHostConfig(withOrigins('CRM_TOKEN=https://crm.example.com,CRM_TOKEN=https://crm.example.com:8443'));
    expect([...two.secrets.get('CRM_TOKEN')!.origins]).toEqual(['https://crm.example.com', 'https://crm.example.com:8443']);
    const repeated = await loadHttpHostConfig(withOrigins('CRM_TOKEN=https://crm.example.com,CRM_TOKEN=https://crm.example.com'));
    expect([...repeated.secrets.get('CRM_TOKEN')!.origins]).toEqual(['https://crm.example.com']);
  });

  it('dos nombres distintos cargan cada uno con su valor', async () => {
    const config = await loadHttpHostConfig({
      FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=https://crm.example.com,SOPORTE_TOKEN=http://soporte.example.com:8080',
      FRANCA_SECRET_CRM_TOKEN: 'Bearer a',
      FRANCA_SECRET_SOPORTE_TOKEN: 'Bearer b',
    });
    expect(config.secrets.get('CRM_TOKEN')!.value).toBe('Bearer a');
    expect(config.secrets.get('SOPORTE_TOKEN')!.value).toBe('Bearer b');
    expect([...config.secrets.get('SOPORTE_TOKEN')!.origins]).toEqual(['http://soporte.example.com:8080']);
  });

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
    'CRM_TOKEN=https://crm.example.com/api',
    'CRM_TOKEN=https://user@crm.example.com',
    'CRM_TOKEN=https://CRM.example.com',
    'CRM_TOKEN=',
    '=https://crm.example.com',
    '1CRM=https://crm.example.com',
    `${'A'.repeat(65)}=https://crm.example.com`,
    'CRM_TOKEN=https://[::1]',
    'CRM_TOKEN=null',
    'CRM_TOKEN=https://crm.example.com?x=1',
    'CRM_TOKEN=https://crm.example.com#x',
    'CRM_TOKEN=http://sub.localhost',
  ];
  it.each(invalid)('«%s» impide arrancar y el mensaje nombra la variable y la posición', async (origins) => {
    const error = await rejection(withOrigins(origins));
    expect(error.message).toContain('FRANCA_HTTP_SECRET_ORIGINS');
    expect(error.message).toContain(origins.includes(', ') ? 'nº 2' : 'nº 1');
    expect(error.message).not.toContain('crm.example.com');
  });

  const empties = ['CRM_TOKEN=https://crm.example.com,', ',CRM_TOKEN=https://crm.example.com', 'CRM_TOKEN=https://crm.example.com,,CRM_TOKEN=https://crm.example.com:8443', ',', ' '];
  it.each(empties)('la entrada vacía «%s» impide arrancar', async (origins) => {
    const error = await rejection(withOrigins(origins));
    expect(error.message).toContain('FRANCA_HTTP_SECRET_ORIGINS');
    if (origins.includes(',')) expect(error.message).toContain('vacía');
  });

  it('la posición es la de la entrada que falla', async () => {
    const error = await rejection(withOrigins('CRM_TOKEN=https://crm.example.com,CRM_TOKEN=https://crm.example.com/'));
    expect(error.message).toContain('nº 2');
  });
});

describe('FRANCA_SECRET_<NOMBRE>', () => {
  const env = (value: string | undefined): Record<string, string | undefined> => ({ FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=https://crm.example.com', FRANCA_SECRET_CRM_TOKEN: value });

  const invalid: [string, string | undefined][] = [
    ['ausente', undefined],
    ['vacía', ''],
    ['blanco al principio', ` Bearer ${MARKER}`],
    ['blanco al final', `Bearer ${MARKER} `],
    ['tabulador al final', `Bearer ${MARKER}\t`],
    ['salto de línea', `Bearer ${MARKER}\n`],
    ['salto de línea interior', `Bearer\n${MARKER}`],
    ['no ASCII', `Bearer ñ-${MARKER}`],
    ['control', `Bearer \u0001${MARKER}`],
    ['8193 caracteres', 'a'.repeat(8193)],
  ];
  it.each(invalid)('%s: no arranca, nombra la variable y no repite el valor', async (_label, value) => {
    const error = await rejection(env(value));
    expect(error.message).toContain('FRANCA_SECRET_CRM_TOKEN');
    expect(error.message).not.toContain(MARKER);
    expect(error.message).not.toContain('aaaa');
  });

  it('admitidos: Bearer x, 1 carácter, 8192 caracteres y un tabulador interior', async () => {
    for (const value of ['Bearer x', 'a', 'a'.repeat(8192), 'Bearer\tx', 'Bearer  dos espacios']) {
      expect((await loadHttpHostConfig(env(value))).secrets.get('CRM_TOKEN')!.value, value.slice(0, 20)).toBe(value);
    }
  });
});

describe('secretos sin origen', () => {
  it('se ignoran, sin validar su valor, y quedan para la línea de arranque', async () => {
    const config = await loadHttpHostConfig({
      FRANCA_SECRET_SOPORTE_TOKEN: `Bearer ${MARKER}`,
      FRANCA_SECRET_VACIO: '',
      FRANCA_SECRET_CON_ñ: 'x',
      FRANCA_SECRET_minuscula: 'x',
      OTRA: 'x',
    });
    expect(config.secrets.size).toBe(0);
    expect(config.ignoredSecretVariables).toEqual(['FRANCA_SECRET_SOPORTE_TOKEN', 'FRANCA_SECRET_VACIO']);
    expect(config.unprintableIgnoredCount).toBe(2);
  });

  it('el nombre de una variable rara no se imprime: se cuenta', async () => {
    const line = describeHttpHostConfig(await loadHttpHostConfig({ 'FRANCA_SECRET_CON_ñ': 'x', FRANCA_SECRET_minuscula: 'x' }));
    expect(line).not.toContain('CON_ñ');
    expect(line).not.toContain('minuscula');
    expect(line).toContain('2 con un nombre que no se muestra');
  });

  it('una variable con origen no se ignora', async () => {
    const config = await loadHttpHostConfig(withOrigins('CRM_TOKEN=https://crm.example.com', { FRANCA_SECRET_CRM_TOKEN: 'Bearer x', FRANCA_SECRET_OTRO: 'y' }));
    expect(config.ignoredSecretVariables).toEqual(['FRANCA_SECRET_OTRO']);
  });
});

describe('FRANCA_HTTP_ALLOWED_DESTINATIONS', () => {
  const load = (value: string | undefined) => loadHttpHostConfig({ FRANCA_HTTP_ALLOWED_DESTINATIONS: value });

  it('ausente o vacía: ninguno', async () => {
    expect((await load(undefined)).allowedDestinations).toEqual([]);
    expect((await load('')).allowedDestinations).toEqual([]);
  });

  it('IPv4 e IPv6 cargan en forma canónica, con su clave', async () => {
    expect((await load('127.0.0.1:8080,[::1]:8443')).allowedDestinations).toEqual([
      { display: '127.0.0.1:8080', key: '127.0.0.1|8080' },
      { display: '[::1]:8443', key: '::1|8443' },
    ]);
    expect((await load('[0:0:0:0:0:0:0:1]:8443,[::ffff:7f00:1]:9000')).allowedDestinations).toEqual([
      { display: '[::1]:8443', key: '::1|8443' },
      { display: '127.0.0.1:9000', key: '127.0.0.1|9000' },
    ]);
  });

  it('un par repetido (escrito igual o de otra forma) se guarda una vez', async () => {
    expect((await load('127.0.0.1:8080,127.0.0.1:8080,[::ffff:127.0.0.1]:8080')).allowedDestinations).toHaveLength(1);
  });

  it('puertos 1 y 65535 y octetos 0 y 255 son válidos', async () => {
    expect((await load('0.0.0.0:1,255.255.255.255:65535')).allowedDestinations.map((entry) => entry.display)).toEqual(['0.0.0.0:1', '255.255.255.255:65535']);
  });

  const invalid = [
    'localhost:8080',
    '127.0.0.1',
    '127.0.0.1:0',
    '127.0.0.1:65536',
    '127.0.0.1:08080',
    '127.0.0.01:8080',
    '::1:8080',
    '10.0.0.0/8:80',
    '*:80',
    '127.0.0.1:8080, 127.0.0.2:8080',
    '256.0.0.1:80',
    '1.2.3:80',
    '[::1]',
    '[::1]:0',
    '[::1%en0]:8080',
    '[crm]:80',
    '[1.2.3.4]:80',
    ' 127.0.0.1:8080',
    '127.0.0.1:8080 ',
    '127.0.0.1:+80',
    '127.0.0.1:80a',
  ];
  it.each(invalid)('«%s» impide arrancar y nombra la variable', async (value) => {
    const error = await rejection({ FRANCA_HTTP_ALLOWED_DESTINATIONS: value });
    expect(error.message).toContain('FRANCA_HTTP_ALLOWED_DESTINATIONS');
    expect(error.message).toContain(value.includes(', ') ? 'nº 2' : 'nº 1');
  });

  it.each(['127.0.0.1:8080,', ',127.0.0.1:8080', '127.0.0.1:8080,,[::1]:8443', ',', ' '])('la entrada vacía «%s» impide arrancar', async (value) => {
    const error = await rejection({ FRANCA_HTTP_ALLOWED_DESTINATIONS: value });
    expect(error.message).toContain('FRANCA_HTTP_ALLOWED_DESTINATIONS');
    if (value.includes(',')) expect(error.message).toContain('vacía');
  });
});

describe('describeHttpHostConfig', () => {
  it('sin configuración dice ninguno / ninguna', async () => {
    expect(describeHttpHostConfig(await loadHttpHostConfig({}))).toBe('salida http: secretos ninguno; variables ignoradas: ninguna; destinos permitidos: ninguno; nombres locales: ninguno');
  });

  it('con configuración contiene nombres, orígenes y pares, y nunca un valor', async () => {
    const line = describeHttpHostConfig(
      await loadHttpHostConfig({
        FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=https://crm.example.com,CRM_TOKEN=https://crm.example.com:8443',
        FRANCA_SECRET_CRM_TOKEN: `Bearer ${MARKER}`,
        FRANCA_SECRET_SOPORTE_TOKEN: `Bearer ${MARKER}-2`,
        FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080,[::1]:8443',
      }),
    );
    expect(line).toBe(
      'salida http: secretos CRM_TOKEN (https://crm.example.com, https://crm.example.com:8443); variables ignoradas: FRANCA_SECRET_SOPORTE_TOKEN; destinos permitidos: 127.0.0.1:8080, [::1]:8443; nombres locales: ninguno',
    );
    expect(line).not.toContain(MARKER);
    expect(line.split('\n')).toHaveLength(1);
  });
});

describe('isNodeUrlOrigin (la sonda del motor)', () => {
  it('acepta los orígenes que puede tener la url de un nodo http', async () => {
    for (const origin of ['https://crm.example.com', 'https://crm.example.com:8443', 'http://crm.example.com', 'http://crm.local.test:8080']) {
      expect(await isNodeUrlOrigin(origin), origin).toBe(true);
    }
  });

  it('rechaza lo que el motor no admite como destino', async () => {
    for (const origin of ['ftp://crm.example.com', 'https://1.2.3.4', 'https://[::1]', 'http://localhost:8080', 'http://a.localhost', 'crm.example.com', '', 'https://', `https://${'a'.repeat(3000)}.example.com`]) {
      expect(await isNodeUrlOrigin(origin), origin).toBe(false);
    }
  });
});

describe('createSecretStore', () => {
  const secrets = new Map([['CRM_TOKEN', { value: 'Bearer x', origins: new Set(['https://crm.example.com', 'https://crm.example.com:8443']) }]]);
  const store = createSecretStore(secrets);

  it('found con el valor para un origen autorizado, también el segundo', () => {
    expect(store.lookup('CRM_TOKEN', 'https://crm.example.com')).toEqual({ kind: 'found', value: 'Bearer x' });
    expect(store.lookup('CRM_TOKEN', 'https://crm.example.com:8443')).toEqual({ kind: 'found', value: 'Bearer x' });
  });

  it('origin_not_allowed: otro puerto, otro esquema, un subdominio y otra capitalización', () => {
    for (const origin of ['https://crm.example.com:9443', 'http://crm.example.com', 'https://api.crm.example.com', 'https://CRM.example.com', 'https://crm.example.com/']) {
      expect(store.lookup('CRM_TOKEN', origin), origin).toEqual({ kind: 'origin_not_allowed' });
    }
  });

  it('not_configured: un nombre desconocido, también los de Object.prototype', () => {
    for (const name of ['OTRO', 'constructor', '__proto__', 'toString']) expect(store.lookup(name, 'https://crm.example.com'), name).toEqual({ kind: 'not_configured' });
  });

  it('lee del mapa en cada consulta: un secreto añadido después se encuentra', () => {
    const live = new Map<string, { value: string; origins: ReadonlySet<string> }>();
    const liveStore = createSecretStore(live);
    expect(liveStore.lookup('X', 'https://a.example.com')).toEqual({ kind: 'not_configured' });
    live.set('X', { value: 'v', origins: new Set(['https://a.example.com']) });
    expect(liveStore.lookup('X', 'https://a.example.com')).toEqual({ kind: 'found', value: 'v' });
  });
});

describe('SECRET_NAME', () => {
  it('es el patrón de secretRef del formato de flujo (@franca/spec)', () => {
    const schema = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('@franca/spec/flow.schema.json'), 'utf8')) as {
      $defs: { secretRef: { properties: { secret: { pattern: string } } } };
    };
    expect(SECRET_NAME.source).toBe(schema.$defs.secretRef.properties.secret.pattern);
  });
});
