import { Socket } from 'node:net';
import type { HttpRequest } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { createAllowedDestinations } from './destination-policy.js';
import { createHttpHost } from './http-host.js';
import { createLocalNames, readLocalNames } from './local-names.js';
import { createSecretStore, type SecretStore } from './secrets.js';

/** Una red sin IO: anota lo que se resuelve y lo que se abre; el socket falla al momento. */
function spy() {
  const lookups: string[] = [];
  const opens: string[] = [];
  const missing: unknown[] = [];
  const blocked: unknown[] = [];
  return {
    lookups,
    opens,
    missing,
    blocked,
    network: {
      resolver: {
        lookup: async (hostname: string) => {
          lookups.push(hostname);
          return [{ address: '93.184.216.34', family: 4 as const }];
        },
      },
      opener: {
        open: (target: { address: string; port: number }) => {
          opens.push(`${target.address}:${target.port}`);
          const socket = new Socket();
          socket.destroy(new Error('conexión rechazada del test'));
          return socket;
        },
      },
    },
    notices: { missingSecret: (notice: unknown) => void missing.push(notice), blocked: (notice: unknown) => void blocked.push(notice) },
  };
}

const NOW = 1_000_000;

async function hostWith(options: { names: string; allowed: string[]; secrets?: SecretStore; now?: number }) {
  const s = spy();
  const capability = createHttpHost({
    secrets: options.secrets ?? createSecretStore(new Map()),
    allowed: createAllowedDestinations(options.allowed.map((key) => ({ key }))),
    network: s.network,
    localNames: createLocalNames(await readLocalNames(options.names)),
    notices: s.notices,
  }).forAdvance({ conversationId: 'c-1', deadlineMs: NOW + 90_000, now: () => options.now ?? NOW });
  return { s, call: (overrides: Partial<HttpRequest>) => capability(request(overrides)) };
}

const request = (overrides: Partial<HttpRequest>): HttpRequest => ({
  nodeId: 'enviar',
  method: 'GET',
  url: 'http://crm.franca.test:4010/',
  headers: [],
  body: null,
  timeoutMs: 2000,
  attempt: 1,
  containsPii: false,
  ...overrides,
});

const LOCAL = 'crm.franca.test=127.0.0.1';

describe('nombres locales: orden de comprobaciones y política (adversarial)', () => {
  it('un secreto ausente gana a blocked: missing_secret sin aviso de bloqueo, sin resolver ni abrir', async () => {
    const { s, call } = await hostWith({ names: LOCAL, allowed: [] });
    const result = await call({ headers: [{ name: 'Authorization', secret: 'CRM_TOKEN' }] });
    expect(result).toEqual({ kind: 'missing_secret' });
    expect(s.blocked).toEqual([]);
    expect(s.missing).toHaveLength(1);
    expect(s.lookups).toEqual([]);
    expect(s.opens).toEqual([]);
  });

  it('el plazo gana a la resolución local: fuera de plazo es timeout sin avisos ni conexión', async () => {
    const { s, call } = await hostWith({ names: LOCAL, allowed: ['127.0.0.1|4010'], now: NOW + 91_000 });
    expect(await call({})).toEqual({ kind: 'timeout' });
    expect(s.opens).toEqual([]);
    expect(s.blocked).toEqual([]);
  });

  it('una resolución local mezclada (solo una dirección permitida) se bloquea entera', async () => {
    const { s, call } = await hostWith({ names: 'crm.franca.test=[::1],crm.franca.test=127.0.0.1', allowed: ['127.0.0.1|4010'] });
    expect(await call({})).toEqual({ kind: 'blocked' });
    expect(s.opens).toEqual([]);
    expect(s.lookups).toEqual([]);
    expect(s.blocked).toEqual([{ conversationId: 'c-1', nodeId: 'enviar', reason: 'internal_destination' }]);
  });

  it.each([['http://crm.franca.test:4011/'], ['http://crm.franca.test/'], ['https://crm.franca.test/']])(
    'el par permitido es dirección y puerto exactos: «%s» con 127.0.0.1:4010 permitido se bloquea',
    async (url) => {
      const { s, call } = await hostWith({ names: LOCAL, allowed: ['127.0.0.1|4010'] });
      expect(await call({ url })).toEqual({ kind: 'blocked' });
      expect(s.opens).toEqual([]);
    },
  );

  it('permitir 127.0.0.1:4010 no abre 127.0.0.2:4010 de otro nombre local', async () => {
    const { s, call } = await hostWith({ names: 'soporte.franca.test=127.0.0.2', allowed: ['127.0.0.1|4010'] });
    expect(await call({ url: 'http://soporte.franca.test:4010/' })).toEqual({ kind: 'blocked' });
    expect(s.opens).toEqual([]);
  });

  it('el host en mayúsculas es local (WHATWG lo baja) y no consulta el DNS', async () => {
    const { s, call } = await hostWith({ names: LOCAL, allowed: ['127.0.0.1|4010'] });
    await call({ url: 'http://CRM.Franca.TEST:4010/' });
    expect(s.lookups).toEqual([]);
    expect(s.opens).toEqual(['127.0.0.1:4010']);
  });

  it.each([['crm.franca.test.'], ['sub.crm.franca.test'], ['crm.franca.test.evil.com'], ['xcrm.franca.test'], ['franca.test']])(
    '«%s» no es el nombre local: pregunta al resolutor y nunca se resuelve a loopback por su cuenta',
    async (hostname) => {
      const { s, call } = await hostWith({ names: LOCAL, allowed: ['127.0.0.1|4010'] });
      await call({ url: `http://${hostname}:4010/` });
      expect(s.lookups).toEqual([hostname]);
      expect(s.opens).toEqual([]);
    },
  );

  it.each([['__proto__'], ['constructor'], ['toString'], ['hasOwnProperty']])('«%s.test» no hereda un nombre local del prototipo', async (label) => {
    const { s, call } = await hostWith({ names: LOCAL, allowed: ['127.0.0.1|4010'] });
    await call({ url: `http://${label}.test:4010/` });
    expect(s.lookups).toEqual([`${label.toLowerCase()}.test`]);
  });
});
