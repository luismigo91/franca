import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config/app-config.js';
import {
  describeHttpHostConfig,
  loadHttpHostConfig,
} from './http-host-config.js';

const ORIGINS = 'FRANCA_HTTP_SECRET_ORIGINS';
const DESTINATIONS = 'FRANCA_HTTP_ALLOWED_DESTINATIONS';
const MARKER = 'valor-no-mostrar-77';

const load = (env: Record<string, string | undefined>) =>
  loadHttpHostConfig(env);
const rejection = async (
  env: Record<string, string | undefined>,
): Promise<string> => {
  try {
    await load(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error(
    `se esperaba un ConfigError con ${JSON.stringify(env).slice(0, 100)}`,
  );
};

describe('QA configuración de la salida http: orígenes de secretos', () => {
  const withSecret = (origins: string): Record<string, string> => ({
    FRANCA_SECRET_CRM_TOKEN: `Bearer ${MARKER}`,
    [ORIGINS]: origins,
  });

  it.each([
    'CRM_TOKEN=https://crm.example.com?x=1',
    'CRM_TOKEN=https://crm.example.com#a',
    'CRM_TOKEN=https://user@crm.example.com',
    'CRM_TOKEN=https://user:pass@crm.example.com',
    'CRM_TOKEN=https://crm.example.com:65536',
    'CRM_TOKEN=http://crm.example.com:80',
    'CRM_TOKEN=https://[::1]',
    'CRM_TOKEN=https://[2606:4700::1111]',
    'CRM_TOKEN=https://127.0.0.1',
    'CRM_TOKEN=https://0x7f.1',
    'CRM_TOKEN=https://2130706433',
    'CRM_TOKEN=https://localhost',
    'CRM_TOKEN=https://crm.localhost',
    'CRM_TOKEN=https://crm.example.com\n',
    'CRM_TOKEN=https://crm .example.com',
    'CRM_TOKEN=https://ÇRM.example.com',
    'CRM_TOKEN=https://crm.example.com\\',
    'CRM_TOKEN=javascript:alert(1)',
    'CRM_TOKEN=//crm.example.com',
    'CRM_TOKEN=crm.example.com',
    'CRM_TOKEN=',
    'CRM_TOKEN',
    '=https://crm.example.com',
    'CRM_TOKEN==https://crm.example.com',
    'CRM_TOKEN= https://crm.example.com',
    'CRM_TOKEN=https://crm.example.com ',
    'crm_token=https://crm.example.com',
    '1CRM=https://crm.example.com',
    `${'A'.repeat(65)}=https://crm.example.com`,
    '_CRM=https://crm.example.com',
    'CRM-TOKEN=https://crm.example.com',
    'CRM_TOKEN=https://crm.example.com;CRM_TOKEN=https://x.example.com',
    'CRM_TOKEN=https://crm.example.com|https://x.example.com',
  ])(
    'no arranca con %j y el mensaje nombra la variable sin repetir el valor del secreto',
    async (origins) => {
      const message = await rejection(withSecret(origins));
      expect(message).toContain(ORIGINS);
      expect(message).not.toContain(MARKER);
    },
  );

  it('admite un nombre de 64 caracteres, varios orígenes con esquemas y puertos distintos y repetidos', async () => {
    const name = `A${'B'.repeat(63)}`;
    const config = await load({
      [`FRANCA_SECRET_${name}`]: 'Bearer x',
      FRANCA_SECRET_CRM_TOKEN: 'Bearer y',
      [ORIGINS]: `${name}=https://crm.example.com,${name}=https://crm.example.com,CRM_TOKEN=http://crm.example.com:8080,CRM_TOKEN=https://crm.example.com:8443`,
    });
    expect([...config.secrets.get(name)!.origins]).toEqual([
      'https://crm.example.com',
    ]);
    expect([...config.secrets.get('CRM_TOKEN')!.origins].sort()).toEqual([
      'http://crm.example.com:8080',
      'https://crm.example.com:8443',
    ]);
  });

  it('un nombre con origen pero sin variable, o con la variable de otro nombre, no arranca y nombra la variable que falta', async () => {
    expect(
      await rejection({ [ORIGINS]: 'CRM_TOKEN=https://crm.example.com' }),
    ).toContain('FRANCA_SECRET_CRM_TOKEN');
    expect(
      await rejection({
        FRANCA_SECRET_CRM: 'Bearer x',
        [ORIGINS]: 'CRM_TOKEN=https://crm.example.com',
      }),
    ).toContain('FRANCA_SECRET_CRM_TOKEN');
    expect(
      await rejection({
        FRANCA_SECRET_CRM_TOKEN: undefined,
        [ORIGINS]: 'CRM_TOKEN=https://crm.example.com',
      }),
    ).toContain('FRANCA_SECRET_CRM_TOKEN');
  });

  it.each([
    ['', false],
    [' ', false],
    ['\t', false],
    ['x', true],
    ['Bearer\tx', true],
    ['Bearer x', true],
    ['a b c', true],
    ['"quoted"', true],
    ['a=b;c', true],
    ['tab-al-final\t', false],
    ['\ttab-al-principio', false],
    ['espacio-al-final ', false],
    ['bad\rvalue', false],
    ['bad\nvalue', false],
    ['bad\u0000value', false],
    ['bad\u007fvalue', false],
    ['bad\u0080value', false],
    ['bad value', false],
    ['bad value', false],
    ['mal-ñ', false],
    ['emoji-😀', false],
    ['a'.repeat(8192), true],
    ['a'.repeat(8193), false],
    [`${'a'.repeat(4000)} ${'b'.repeat(4000)}`, true],
  ])('valor de secreto %j → admitido=%s', async (value, accepted) => {
    const env = {
      FRANCA_SECRET_CRM_TOKEN: value,
      [ORIGINS]: 'CRM_TOKEN=https://crm.example.com',
    };
    if (accepted) {
      expect((await load(env)).secrets.get('CRM_TOKEN')?.value).toBe(value);
    } else {
      const message = await rejection(env);
      expect(message).toContain('FRANCA_SECRET_CRM_TOKEN');
      if (value.trim().length >= 4) expect(message).not.toContain(value);
    }
  });

  it('las variables FRANCA_SECRET_* sin origen se ignoran aunque su valor sea basura; la línea de arranque nunca imprime un valor', async () => {
    const env: Record<string, string> = {
      FRANCA_SECRET_SOPORTE: `Bearer ${MARKER}-ignorado`,
      FRANCA_SECRET_BASURA: '\u0000\r\n😀',
      FRANCA_SECRET_minuscula: `${MARKER}-minuscula`,
      [`FRANCA_SECRET_${'X'.repeat(80)}`]: `${MARKER}-largo`,
      FRANCA_SECRET_: `${MARKER}-vacio`,
      FRANCA_SECRET_CRM_TOKEN: `Bearer ${MARKER}`,
      [ORIGINS]: 'CRM_TOKEN=https://crm.example.com',
      [DESTINATIONS]: '127.0.0.1:8080',
    };
    const config = await load(env);
    expect([...config.secrets.keys()]).toEqual(['CRM_TOKEN']);
    expect(config.ignoredSecretVariables).toEqual([
      'FRANCA_SECRET_BASURA',
      'FRANCA_SECRET_SOPORTE',
    ]);
    expect(config.unprintableIgnoredCount).toBe(3);
    const line = describeHttpHostConfig(config);
    expect(line).not.toContain(MARKER);
    expect(line).not.toMatch(/\n|\r/);
    expect(line).toContain('FRANCA_SECRET_SOPORTE');
    expect(line).toContain('https://crm.example.com');
    expect(line).toContain('127.0.0.1:8080');
  });

  it('sin variables no hay secretos ni destinos y la línea lo dice', async () => {
    const config = await load({});
    expect(describeHttpHostConfig(config)).toBe(
      'salida http: secretos ninguno; variables ignoradas: ninguna; destinos permitidos: ninguno; nombres locales: ninguno',
    );
    expect(
      (await load({ [ORIGINS]: '', [DESTINATIONS]: '' })).secrets.size,
    ).toBe(0);
  });
});

describe('QA configuración de la salida http: destinos permitidos', () => {
  const destinations = async (value: string) =>
    (await load({ [DESTINATIONS]: value })).allowedDestinations.map(
      (entry) => entry.display,
    );

  it.each([
    '127.0.0.1:8080,',
    ',127.0.0.1:8080',
    '127.0.0.1:8080,,[::1]:8443',
    ',',
    ' ',
    '127.0.0.1:8080 ',
    ' 127.0.0.1:8080',
    '127.0.0.1:8080, [::1]:80',
    '127.0.0.1:0',
    '127.0.0.1:00080',
    '127.0.0.1:+80',
    '127.0.0.1:-1',
    '127.0.0.1:65536',
    '127.0.0.1:99999',
    '127.0.0.1:80x',
    '127.0.0.1:0x50',
    '127.0.0.1:8e1',
    '127.0.0.1',
    '127.0.0.1:',
    ':80',
    '127.1:80',
    '0x7f.0.0.1:80',
    '2130706433:80',
    '127.0.0.01:80',
    '127.0.0.256:80',
    '127.0.0.1.1:80',
    'localhost:80',
    'crm.example.com:80',
    '::1:80',
    '[::1]',
    '[::1]:',
    '[::1:80',
    '::1]:80',
    '[[::1]]:80',
    '[::1%lo0]:80',
    '[fe80::1%en0]:80',
    '[1.2.3.4]:80',
    '[localhost]:80',
    '[::g]:80',
    '[::1]:080',
    '[::1]:80 ',
    '٠.٠.٠.٠:80',
    '０.０.０.０:80',
    '127.0.0.1:٨٠',
    '127.0.0.1/8:80',
    '10.0.0.0/8:80',
    '*:80',
    '127.0.0.1:80;127.0.0.1:81',
    '127.0.0.1:80\n',
    '127.0.0.1:80\u0000',
  ])('no arranca con %j y el mensaje nombra la variable', async (value) => {
    const message = await rejection({ [DESTINATIONS]: value });
    expect(message).toContain(DESTINATIONS);
  });

  it('un error dice la posición de la entrada mala', async () => {
    expect(
      await rejection({ [DESTINATIONS]: '127.0.0.1:80,[::1]:81,mala' }),
    ).toContain('nº 3');
    expect(
      await rejection({ [DESTINATIONS]: '127.0.0.1:80,,[::1]:81' }),
    ).toContain('nº 2');
  });

  it('admite IPv4, IPv6 entre corchetes en cualquier forma, el puerto 1 y el 65535, y las repetidas por forma se juntan', async () => {
    expect(
      await destinations(
        '127.0.0.1:1,127.0.0.1:65535,[::1]:8443,[0:0:0:0:0:0:0:1]:8443,[0000::0001]:8443,[::ffff:127.0.0.1]:1,[::FFFF:7F00:1]:1,[2001:DB8:0:0:1:0:0:1]:80,[fe80::1]:80',
      ),
    ).toEqual([
      '127.0.0.1:1',
      '127.0.0.1:65535',
      '[::1]:8443',
      '[2001:db8::1:0:0:1]:80',
      '[fe80::1]:80',
    ]);
  });

  it('una mapeada permitida es la IPv4: las dos claves son la misma', async () => {
    const config = await load({
      [DESTINATIONS]: '[::ffff:10.0.0.5]:80,10.0.0.5:80',
    });
    expect(config.allowedDestinations).toHaveLength(1);
    expect(config.allowedDestinations[0]!.key).toBe('10.0.0.5|80');
  });
});
