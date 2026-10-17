import { Socket } from 'node:net';
import type { HttpRequest } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { createAllowedDestinations } from './destination-policy.js';
import { createHttpHost, type AdvanceContext } from './http-host.js';
import type { HttpNetwork } from './network.js';
import type { HttpNotices } from './notices.js';
import { createSecretStore, type SecretStore } from './secrets.js';

type Answer = readonly { address: unknown; family: unknown }[];

interface Spy {
  readonly network: HttpNetwork;
  readonly lookups: string[];
  readonly opens: { address: string; family: 4 | 6; port: number }[];
  readonly missing: unknown[];
  readonly blocked: unknown[];
  readonly notices: HttpNotices;
}

/** Una red sin IO: el resolutor da lo que se le diga y el abridor devuelve un socket que falla al momento. */
function spyNetwork(resolve: (hostname: string) => Promise<Answer> | Answer = () => [{ address: '1.2.3.4', family: 4 }], open?: () => Socket): Spy {
  const lookups: string[] = [];
  const opens: Spy['opens'] = [];
  const missing: unknown[] = [];
  const blocked: unknown[] = [];
  return {
    lookups,
    opens,
    missing,
    blocked,
    notices: { missingSecret: (notice) => void missing.push(notice), blocked: (notice) => void blocked.push(notice) },
    network: {
      resolver: {
        lookup: async (hostname) => {
          lookups.push(hostname);
          return resolve(hostname);
        },
      },
      opener: {
        open: (target) => {
          opens.push(target);
          if (open) return open();
          // Destruido al momento y con error: una conexión rechazada, sin IO.
          const socket = new Socket();
          socket.destroy(new Error('conexión rechazada del test'));
          return socket;
        },
      },
    },
  };
}

const noSecrets: SecretStore = createSecretStore(new Map());
const withSecret: SecretStore = createSecretStore(new Map([['CRM_TOKEN', { value: 'Bearer MARCA-VALOR', origins: new Set(['https://crm.example.com']) }]]));

const request = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  nodeId: 'enviar',
  method: 'GET',
  url: 'https://api.example.com/x',
  headers: [],
  body: null,
  timeoutMs: 2000,
  attempt: 1,
  containsPii: false,
  ...overrides,
});

const NOW = 1_000_000;
const context = (overrides: Partial<AdvanceContext> = {}): AdvanceContext => ({ conversationId: 'c-1', deadlineMs: NOW + 90_000, now: () => NOW, ...overrides });

function host(spy: Spy, options: { secrets?: SecretStore; allowed?: string[]; ctx?: Partial<AdvanceContext> } = {}) {
  const capability = createHttpHost({
    secrets: options.secrets ?? noSecrets,
    allowed: createAllowedDestinations((options.allowed ?? []).map((key) => ({ key }))),
    network: spy.network,
    notices: spy.notices,
  }).forAdvance(context(options.ctx));
  return capability;
}

const secretHeader = [{ name: 'Authorization', secret: 'CRM_TOKEN' }];

describe('createHttpHost: orden de un intento', () => {
  it('sin secreto, missing_secret sin resolver ni abrir nada, y avisa con el id, el nodo, el nombre y el motivo', async () => {
    const spy = spyNetwork();
    const result = await host(spy)(request({ url: 'https://crm.example.com/', headers: secretHeader }));
    expect(result).toEqual({ kind: 'missing_secret' });
    expect(spy.lookups).toEqual([]);
    expect(spy.opens).toEqual([]);
    expect(spy.missing).toEqual([{ conversationId: 'c-1', nodeId: 'enviar', secret: 'CRM_TOKEN', reason: 'not_configured' }]);
  });

  it('un secreto para otro origen: origin_not_allowed, sin resolver ni abrir nada', async () => {
    const spy = spyNetwork();
    for (const url of ['https://crm.example.com:8443/', 'http://crm.example.com/', 'https://api.crm.example.com/']) {
      expect(await host(spy, { secrets: withSecret })(request({ url, headers: secretHeader })), url).toEqual({ kind: 'missing_secret' });
    }
    expect(spy.lookups).toEqual([]);
    expect(spy.opens).toEqual([]);
    expect(spy.missing.map((notice) => (notice as { reason: string }).reason)).toEqual(['origin_not_allowed', 'origin_not_allowed', 'origin_not_allowed']);
  });

  it('los secretos se comprueban antes que el plazo: fuera de plazo y sin secreto es missing_secret', async () => {
    const spy = spyNetwork();
    const result = await host(spy, { ctx: { now: () => NOW + 91_000 } })(request({ url: 'https://crm.example.com/', headers: secretHeader }));
    expect(result).toEqual({ kind: 'missing_secret' });
    expect(spy.lookups).toEqual([]);
  });

  it('pasado el plazo (o justo en él), timeout sin resolver ni conectar', async () => {
    const spy = spyNetwork();
    for (const elapsed of [90_000, 91_000]) {
      expect(await host(spy, { ctx: { now: () => NOW + elapsed } })(request()), `${elapsed}`).toEqual({ kind: 'timeout' });
    }
    expect(spy.lookups).toEqual([]);
    expect(spy.opens).toEqual([]);
  });

  it('un intento con plazo restante se recorta a él: una resolución que no termina da timeout a los 40 ms, no a los 2 s', async () => {
    const spy = spyNetwork(() => new Promise<Answer>(() => undefined));
    const started = Date.now();
    const result = await host(spy, { ctx: { deadlineMs: NOW + 40 } })(request({ timeoutMs: 2000 }));
    expect(result).toEqual({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(spy.lookups).toEqual(['api.example.com']);
  });

  it('con un resolutor que nunca responde, el timeoutMs del nodo manda', async () => {
    const spy = spyNetwork(() => new Promise<Answer>(() => undefined));
    const started = Date.now();
    expect(await host(spy)(request({ timeoutMs: 60 }))).toEqual({ kind: 'timeout' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it('blocked sin abrir nada, con el aviso del motivo y sin nombre ni direcciones', async () => {
    const spy = spyNetwork(() => [{ address: '10.0.0.5', family: 4 }]);
    expect(await host(spy)(request({ url: 'https://crm.example.com/' }))).toEqual({ kind: 'blocked' });
    expect(spy.opens).toEqual([]);
    expect(spy.blocked).toEqual([{ conversationId: 'c-1', nodeId: 'enviar', reason: 'internal_destination' }]);
    expect(JSON.stringify(spy.blocked)).not.toContain('crm.example.com');
    expect(JSON.stringify(spy.blocked)).not.toContain('10.0.0.5');
  });

  it('http:// hacia una pública es blocked con insecure_transport, y con una interna gana internal_destination', async () => {
    const insecure = spyNetwork();
    expect(await host(insecure)(request({ url: 'http://api.example.com/' }))).toEqual({ kind: 'blocked' });
    expect(insecure.blocked).toEqual([{ conversationId: 'c-1', nodeId: 'enviar', reason: 'insecure_transport' }]);
    const both = spyNetwork(() => [{ address: '10.0.0.5', family: 4 }]);
    await host(both)(request({ url: 'http://api.example.com/' }));
    expect(both.blocked).toEqual([{ conversationId: 'c-1', nodeId: 'enviar', reason: 'internal_destination' }]);
    expect(insecure.opens).toEqual([]);
  });

  it('un par permitido deja pasar http:// y llega al abridor con la dirección canónica y el puerto', async () => {
    const spy = spyNetwork(() => [{ address: '::ffff:7f00:1', family: 6 }]);
    const result = await host(spy, { allowed: ['127.0.0.1|8080'] })(request({ url: 'http://crm.local.test:8080/' }));
    expect(spy.opens).toEqual([{ address: '127.0.0.1', family: 4, port: 8080 }]);
    expect(result).toEqual({ kind: 'network_error', requestSent: false });
  });

  it('prueba las direcciones en el orden de la resolución y, si todas rechazan, network_error sin enviar', async () => {
    const spy = spyNetwork(() => [
      { address: '1.2.3.5', family: 4 },
      { address: '2606:4700::1111', family: 6 },
      { address: '1.2.3.5', family: 4 },
    ]);
    expect(await host(spy)(request())).toEqual({ kind: 'network_error', requestSent: false });
    expect(spy.opens).toEqual([
      { address: '1.2.3.5', family: 4, port: 443 },
      { address: '2606:4700::1111', family: 6, port: 443 },
    ]);
  });
});

describe('createHttpHost: la resolución en producción', () => {
  it('un rechazo del resolutor, una lista vacía y algo que no es una lista dan network_error sin enviar', async () => {
    const failing = spyNetwork(() => Promise.reject(new Error('ENOTFOUND')));
    expect(await host(failing)(request())).toEqual({ kind: 'network_error', requestSent: false });
    for (const answer of [[], null, undefined, 'x', {}, { 0: { address: '1.2.3.4', family: 4 }, length: 1 }]) {
      const spy = spyNetwork(() => answer as unknown as Answer);
      expect(await host(spy)(request()), JSON.stringify(answer)).toEqual({ kind: 'network_error', requestSent: false });
      expect(spy.opens).toEqual([]);
    }
  });

  it('un resolutor que lanza de forma síncrona también', async () => {
    const spy = spyNetwork();
    const network: HttpNetwork = {
      ...spy.network,
      resolver: {
        lookup: () => {
          throw new Error('ENOTFOUND');
        },
      },
    };
    const capability = createHttpHost({ secrets: noSecrets, allowed: createAllowedDestinations([]), network, notices: spy.notices }).forAdvance(context());
    expect(await capability(request())).toEqual({ kind: 'network_error', requestSent: false });
  });

  it('una entrada que no es una dirección bloquea la resolución entera, esté donde esté', async () => {
    for (const entries of [[{ address: 'crm.example.com', family: 4 }], [{ address: '1.2.3.4', family: 4 }, { address: undefined, family: 4 }], [{ address: 7, family: 4 }, { address: '1.2.3.4', family: 4 }], [{ address: '1.2.3.4', family: 6 }]]) {
      const spy = spyNetwork(() => entries);
      expect(await host(spy)(request()), JSON.stringify(entries)).toEqual({ kind: 'blocked' });
      expect(spy.opens).toEqual([]);
      expect(spy.blocked).toEqual([{ conversationId: 'c-1', nodeId: 'enviar', reason: 'internal_destination' }]);
    }
  });

  it('un host que ya es una IP se resuelve a sí mismo, sin consultar, y pasa por la misma política', async () => {
    const internal = spyNetwork();
    expect(await host(internal)(request({ url: 'https://[::1]/' }))).toEqual({ kind: 'blocked' });
    expect(internal.lookups).toEqual([]);
    const pub = spyNetwork();
    await host(pub)(request({ url: 'https://1.2.3.4/' }));
    expect(pub.lookups).toEqual([]);
    expect(pub.opens).toEqual([{ address: '1.2.3.4', family: 4, port: 443 }]);
  });

  it('una url que no es http(s) o no se puede leer es network_error sin enviar, sin resolver', async () => {
    const spy = spyNetwork();
    for (const url of ['ftp://api.example.com/', 'no es una url', 'file:///etc/passwd']) {
      expect(await host(spy)(request({ url })), url).toEqual({ kind: 'network_error', requestSent: false });
    }
    expect(spy.lookups).toEqual([]);
  });
});

describe('createHttpHost: la promesa nunca se rechaza', () => {
  it('un abridor que lanza da network_error sin enviar', async () => {
    const spy = spyNetwork(undefined, () => {
      throw new Error('EMFILE');
    });
    expect(await host(spy)(request())).toEqual({ kind: 'network_error', requestSent: false });
  });

  it('un almacén de secretos que lanza da network_error', async () => {
    const throwing: SecretStore = {
      lookup: () => {
        throw new Error('almacén roto');
      },
    };
    const spy = spyNetwork();
    expect(await host(spy, { secrets: throwing })(request({ headers: secretHeader }))).toEqual({ kind: 'network_error', requestSent: true });
  });

  it('un aviso que lanza no cambia el resultado', async () => {
    const spy = spyNetwork();
    const notices: HttpNotices = {
      missingSecret: () => {
        throw new Error('registro roto');
      },
      blocked: () => {
        throw new Error('registro roto');
      },
    };
    const capability = createHttpHost({ secrets: noSecrets, allowed: createAllowedDestinations([]), network: spy.network, notices }).forAdvance(context());
    expect(await capability(request({ headers: secretHeader }))).toEqual({ kind: 'missing_secret' });
    const internal = spyNetwork(() => [{ address: '10.0.0.5', family: 4 }]);
    const blocking = createHttpHost({ secrets: noSecrets, allowed: createAllowedDestinations([]), network: internal.network, notices }).forAdvance(context());
    expect(await blocking(request())).toEqual({ kind: 'blocked' });
  });

  it('cada resultado es un objeto nuevo con solo los campos del contrato', async () => {
    const spy = spyNetwork(() => [{ address: '10.0.0.5', family: 4 }]);
    const capability = host(spy);
    const first = await capability(request());
    const second = await capability(request());
    expect(first).toEqual({ kind: 'blocked' });
    expect(Object.keys(first)).toEqual(['kind']);
    expect(first).not.toBe(second);
    const failed = await host(spyNetwork(() => []))(request());
    expect(Object.keys(failed).sort()).toEqual(['kind', 'requestSent']);
  });

  it('el valor del secreto nunca llega a un aviso', async () => {
    const spy = spyNetwork(() => [{ address: '10.0.0.5', family: 4 }]);
    await host(spy, { secrets: withSecret })(request({ url: 'https://crm.example.com/', headers: secretHeader }));
    expect(JSON.stringify([spy.missing, spy.blocked])).not.toContain('MARCA-VALOR');
  });
});
