import { afterEach, describe, expect, it } from 'vitest';
import { dumpConversationTables } from './helpers/conversations.js';
import { finishing } from './helpers/conversations-llm.js';
import {
  httpChain,
  httpEvents,
  leadsWith,
  llmHttp,
} from './helpers/http-flows.js';
import {
  CRM_VARIABLES,
  P,
  P1,
  P2,
  startWorld,
  type HttpWorld,
} from './helpers/http-world.js';

const TLS_API = {
  tls: { hostname: 'api.example.com', authority: 'trusted' },
} as const;
const TLS_CRM = {
  tls: { hostname: 'crm.example.com', authority: 'trusted' },
} as const;
const SECRET = 'prueba-crm-1';
const TOLERANCE_MS = 1500;
let sequence = 0;

describe('QA salida http: política, secretos y plazo (e2e)', () => {
  let current: HttpWorld | undefined;
  const closeCurrent = async (): Promise<void> => {
    const previous = current;
    current = undefined;
    await previous?.close();
  };
  afterEach(closeCurrent);

  /** Una API nueva con las variables dadas; cierra la anterior (la salida capturada es global). */
  async function world(
    variables: Record<string, string> = {},
  ): Promise<HttpWorld> {
    await closeCurrent();
    current = await startWorld({ variables });
    return current;
  }

  /** Una conversación de una cadena de llamadas; devuelve el cuerpo del avance y sus eventos `http`. */
  async function run(
    w: HttpWorld,
    calls: Parameters<typeof httpChain>[0],
  ): Promise<{ body: any; events: any[] }> {
    const flow = httpChain(calls, `qa-cadena-${(sequence += 1)}`);
    await w.ctx.publish(flow);
    const { body } = await w.ctx.start(flow.id);
    return { body, events: httpEvents(body) };
  }
  /** Las llamadas en conversaciones de hasta 10 (el tope de llamadas externas por avance), con todos sus eventos `http` en orden. */
  async function runAll(
    w: HttpWorld,
    calls: Parameters<typeof httpChain>[0],
  ): Promise<{ statuses: string[]; events: any[] }> {
    const statuses: string[] = [];
    const events: any[] = [];
    for (let start = 0; start < calls.length; start += 10) {
      const result = await run(w, calls.slice(start, start + 10));
      statuses.push(result.body.conversation.status);
      events.push(...result.events);
    }
    return { statuses, events };
  }
  const without = ({ type: _type, nodeId: _nodeId, ...rest }: any): object =>
    rest;

  describe('clasificación de destinos a través de toda la pila', () => {
    const INTERNAL: string[] = [
      '0.0.0.0',
      '255.255.255.255',
      '169.254.169.254',
      '100.64.0.1',
      '100.127.255.255',
      '192.0.0.1',
      '192.0.0.255',
      '198.18.0.1',
      '198.19.255.255',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '192.88.99.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '::',
      '::1',
      '::127.0.0.1',
      '::1.2.3.4',
      '::ffff:0:1.2.3.4',
      'fe80::1',
      'fe80::1%en0',
      'fc00::1',
      'fd00:ec2::254',
      'ff02::1',
      '2001:db8::1',
      '2001::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      '2002:7f00:1::1',
      '2002:102:304::1',
      '64:ff9b:1::102:304',
      '64:ff9b::7f00:1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b::ffff:ffff',
      '::ffff:127.0.0.1',
      '::ffff:a9fe:a9fe',
      '::ffff:0.0.0.0',
      '3fff::1',
      '100::1',
      '5f00::1',
      '2001:2::1',
    ];

    it('cada dirección interna, en la forma en que la dé el resolutor, se bloquea sin abrir ninguna conexión ni a https ni a http', async () => {
      const w = await world({
        FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080',
      });
      INTERNAL.forEach((address, index) =>
        w.network.resolve(`n${index}.example.com`, [address]),
      );
      for (const scheme of ['https', 'http']) {
        const { events, statuses } = await runAll(
          w,
          INTERNAL.map((_address, index) => ({
            method: 'GET' as const,
            url: `${scheme}://n${index}.example.com/`,
            retries: 0,
          })),
        );
        expect(new Set(statuses)).toEqual(new Set(['ended']));
        expect(
          events.map((event) => event.error),
          scheme,
        ).toEqual(INTERNAL.map(() => 'blocked'));
        expect(events.map((event) => event.attempts)).toEqual(
          INTERNAL.map(() => 1),
        );
      }
      expect(w.network.connections()).toEqual([]);
      expect(w.output.text()).toContain('internal_destination');
    });

    it('un par permitido solo abre esa dirección con ese puerto, escrita como se escriba, y nada más', async () => {
      const w = await world({
        FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080',
      });
      const server = await w.serveAt('127.0.0.1', 8080, {
        kind: 'respond',
        status: 200,
      });
      w.network.resolve('ok-a.example.com', ['127.0.0.1']);
      w.network.resolve('ok-b.example.com', ['::ffff:127.0.0.1']);
      w.network.resolve('ok-c.example.com', ['::ffff:7f00:1']);
      w.network.resolve('otro-puerto.example.com', ['127.0.0.1']);
      w.network.resolve('otra-ip.example.com', ['127.0.0.2']);
      w.network.resolve('mezcla.example.com', ['127.0.0.1', '127.0.0.2']);
      w.network.resolve('mezcla-publica.example.com', ['127.0.0.1', P]);
      w.network.resolve('v6.example.com', ['::1']);
      const { events } = await run(w, [
        { method: 'GET', url: 'http://ok-a.example.com:8080/', retries: 0 },
        { method: 'GET', url: 'http://ok-b.example.com:8080/', retries: 0 },
        { method: 'GET', url: 'http://ok-c.example.com:8080/', retries: 0 },
        {
          method: 'GET',
          url: 'http://otro-puerto.example.com:8081/',
          retries: 0,
        },
        { method: 'GET', url: 'http://otro-puerto.example.com/', retries: 0 },
        { method: 'GET', url: 'http://otra-ip.example.com:8080/', retries: 0 },
        { method: 'GET', url: 'http://mezcla.example.com:8080/', retries: 0 },
        {
          method: 'GET',
          url: 'http://mezcla-publica.example.com:8080/',
          retries: 0,
        },
        { method: 'GET', url: 'http://v6.example.com:8080/', retries: 0 },
        { method: 'GET', url: 'https://ok-a.example.com:8080/', retries: 0 },
      ]);
      expect(events.slice(0, 3).map(without)).toEqual(
        Array(3).fill({ attempts: 1, status: 200, error: null }),
      );
      expect(events.slice(3, 9).map((event) => event.error)).toEqual(
        Array(6).fill('blocked'),
      );
      // El último es https hacia un par permitido que habla http en claro: la conexión se abre pero el TLS falla (no es blocked).
      expect(events[9]).toMatchObject({ status: null, error: 'network_error' });
      expect(server.received()).toHaveLength(3);
      expect(
        w.network
          .connections()
          .filter((c) => c.address !== '127.0.0.1' || c.port !== 8080),
      ).toEqual([]);
    });
  });

  describe('resolución hostil', () => {
    it('resolución vacía: network_error sin enviar (se reintenta), sin conectar y sin avisos de bloqueo', async () => {
      const w = await world();
      w.network.resolve('api.example.com', []);
      const { events } = await run(w, [
        {
          method: 'POST',
          url: 'https://api.example.com/x',
          body: { a: 1 },
          retries: 2,
        },
      ]);
      expect(events.map(without)).toEqual([
        { attempts: 3, status: null, error: 'network_error' },
      ]);
      expect(w.network.resolutions('api.example.com')).toBe(3);
      expect(w.network.connections()).toEqual([]);
      expect(w.output.text()).not.toContain('blocked');
    });

    it('un resolutor que rechaza con basura, devuelve algo que no es una lista o una lista con entradas rotas nunca conecta', async () => {
      const w = await world();
      const resolver = w.network.resolver as {
        lookup: (hostname: string) => Promise<unknown>;
      };
      const original = resolver.lookup;
      const answers: [string, () => Promise<unknown>][] = [
        ['rechazo sin Error', () => Promise.reject(undefined)],
        ['una cadena', () => Promise.resolve('1.2.3.4')],
        [
          'un objeto con length',
          () =>
            Promise.resolve({
              length: 1,
              0: { address: '1.2.3.4', family: 4 },
            }),
        ],
        ['null', () => Promise.resolve(null)],
        ['entrada null', () => Promise.resolve([null])],
        ['entrada sin address', () => Promise.resolve([{ family: 4 }])],
        [
          'address no cadena',
          () => Promise.resolve([{ address: 16909060, family: 4 }]),
        ],
        [
          'familia equivocada',
          () => Promise.resolve([{ address: '1.2.3.4', family: 6 }]),
        ],
        [
          'pública y basura',
          () =>
            Promise.resolve([
              { address: '1.2.3.4', family: 4 },
              { address: '1.2.3.4\u0000', family: 4 },
            ]),
        ],
      ];
      try {
        for (const [label, answer] of answers) {
          resolver.lookup = async () => answer();
          const { events, body } = await run(w, [
            { method: 'GET', url: 'https://api.example.com/x', retries: 0 },
          ]);
          expect(body.conversation, label).toMatchObject({
            status: 'ended',
            error: null,
          });
          expect(events, label).toHaveLength(1);
          expect(events[0].status, label).toBeNull();
          expect(['blocked', 'network_error'], label).toContain(
            events[0].error,
          );
        }
      } finally {
        resolver.lookup = original;
      }
      expect(w.network.connections()).toEqual([]);
    });

    it('la resolución se hace una vez por intento y se conecta a la decidida, en orden: refusal en la primera, éxito en la segunda', async () => {
      const w = await world();
      w.network.resolve('api.example.com', [P1, P2, P]);
      const server = await w.serveAt(
        P,
        443,
        { kind: 'respond', status: 200 },
        TLS_API,
      );
      const { events } = await run(w, [
        { method: 'GET', url: 'https://api.example.com/x', retries: 0 },
      ]);
      expect(events.map(without)).toEqual([
        { attempts: 1, status: 200, error: null },
      ]);
      expect(w.network.resolutions('api.example.com')).toBe(1);
      expect(w.network.connections()).toEqual([
        { address: P1, port: 443 },
        { address: P2, port: 443 },
        { address: P, port: 443 },
      ]);
      expect(server.received()).toHaveLength(1);
    });

    it('si la primera dirección ya recibió la petición y cierra sin responder, NO se prueba la segunda (no se duplica un POST)', async () => {
      const w = await world();
      w.network.resolve('api.example.com', [P1, P]);
      const first = await w.serveAt(
        P1,
        443,
        { kind: 'read-and-close' },
        TLS_API,
      );
      const second = await w.serveAt(
        P,
        443,
        { kind: 'respond', status: 200 },
        TLS_API,
      );
      const { events } = await run(w, [
        {
          method: 'POST',
          url: 'https://api.example.com/x',
          body: { a: 1 },
          retries: 0,
        },
      ]);
      expect(events.map(without)).toEqual([
        { attempts: 1, status: null, error: 'network_error' },
      ]);
      expect(first.received()).toHaveLength(1);
      expect(second.connections()).toBe(0);
      expect(w.network.connections()).toEqual([{ address: P1, port: 443 }]);
    });

    it('un fallo de TLS en la primera dirección (certificado de otro nombre) no envía nada y se pasa a la segunda', async () => {
      const w = await world();
      w.network.resolve('api.example.com', [P1, P]);
      const bad = await w.serveAt(
        P1,
        443,
        { kind: 'respond', status: 200 },
        { tls: { hostname: 'otro.example.com', authority: 'trusted' } },
      );
      const good = await w.serveAt(
        P,
        443,
        { kind: 'respond', status: 200 },
        TLS_API,
      );
      const { events } = await run(w, [
        {
          method: 'POST',
          url: 'https://api.example.com/x',
          body: { a: 1 },
          retries: 0,
        },
      ]);
      expect(events.map(without)).toEqual([
        { attempts: 1, status: 200, error: null },
      ]);
      expect(bad.received()).toHaveLength(0);
      expect(good.received()).toHaveLength(1);
    });

    it('una cola de 60 direcciones públicas sin servidor acaba en network_error sin enviar (y se reintenta), sin colgarse', async () => {
      const w = await world();
      const addresses = Array.from(
        { length: 60 },
        (_unused, index) => `1.2.${index + 10}.1`,
      );
      w.network.resolve('api.example.com', addresses);
      const started = Date.now();
      const { events } = await run(w, [
        {
          method: 'POST',
          url: 'https://api.example.com/x',
          body: { a: 1 },
          timeoutMs: 10_000,
          retries: 1,
        },
      ]);
      expect(events.map(without)).toEqual([
        { attempts: 2, status: null, error: 'network_error' },
      ]);
      expect(Date.now() - started).toBeLessThan(8000);
      expect(w.network.connections()).toHaveLength(120);
    });

    it('DNS rebinding entre el primer y el segundo intento: el segundo se bloquea y el secreto no viaja', async () => {
      const w = await world({
        ...CRM_VARIABLES,
        FRANCA_SECRET_OTRO: 'Bearer prueba-otro-1',
        FRANCA_HTTP_SECRET_ORIGINS:
          'CRM_TOKEN=https://crm.example.com,OTRO=https://api.example.com',
      });
      const server = await w.serveAt(
        P,
        443,
        { kind: 'respond', status: 503 },
        { tls: { hostname: 'api.example.com', authority: 'trusted' } },
      );
      w.network.resolve('api.example.com', [P], ['169.254.169.254']);
      const { events } = await run(w, [
        {
          method: 'GET',
          url: 'https://api.example.com/x',
          headers: { Authorization: { secret: 'OTRO' } },
          retries: 1,
        },
      ]);
      expect(events.map(without)).toEqual([
        { attempts: 2, status: null, error: 'blocked' },
      ]);
      expect(server.received()).toHaveLength(1);
      expect(w.network.connections()).toEqual([{ address: P, port: 443 }]);
    });
  });

  describe('secretos', () => {
    const received = (server: {
      received(): readonly { headers: Record<string, string> }[];
    }): string[] =>
      server.received().map((request) => request.headers.authorization ?? '');

    it.each([
      [301, 'https://evil.example.com/robar'],
      [302, '//evil.example.com/x'],
      [303, 'https://crm.example.com/otra'],
      [307, 'http://1.2.3.6/x'],
      [308, '/ruta-relativa'],
    ])(
      'una respuesta %i hacia %s es un status más: una sola petición y ninguna conexión extra',
      async (status, location) => {
        const w = await world(CRM_VARIABLES);
        const crm = await w.crm(
          { kind: 'respond', status, headers: { location }, body: '' },
          TLS_CRM,
        );
        const { events } = await run(w, [
          {
            method: 'GET',
            url: 'https://crm.example.com/api',
            headers: { Authorization: { secret: 'CRM_TOKEN' } },
            retries: 0,
          },
        ]);
        expect(events.map(without)).toEqual([
          { attempts: 1, status, error: 'http_status' },
        ]);
        expect(crm.received()).toHaveLength(1);
        expect(w.network.connections()).toEqual([{ address: P, port: 443 }]);
        expect(w.network.resolved()).toEqual(['crm.example.com']);
      },
    );

    it.each(['https://crm.example.com./', 'https://crm.example.com.:443/x'])(
      'un host con punto final (%s) ni siquiera llega al host de la API y no conecta',
      async (url) => {
        const w = await world(CRM_VARIABLES);
        const crm = await w.crm(undefined, TLS_CRM);
        const { events, body } = await run(w, [
          {
            method: 'GET',
            url,
            headers: { Authorization: { secret: 'CRM_TOKEN' } },
            retries: 0,
          },
        ]);
        expect(
          body.conversation.error === null ||
            body.conversation.error.code === 'missing_secret',
        ).toBe(true);
        expect(events.every((event) => event.status === null)).toBe(true);
        expect(w.network.connections()).toEqual([]);
        expect(crm.received()).toHaveLength(0);
      },
    );

    it('el secreto autorizado para https://crm.example.com no viaja por http:// al mismo host aunque el par esté permitido', async () => {
      const w = await world({
        ...CRM_VARIABLES,
        FRANCA_HTTP_ALLOWED_DESTINATIONS: `${P}:80`,
      });
      const plain = await w.serveAt(P, 80, { kind: 'respond', status: 200 });
      w.network.resolve('crm.example.com', [P]);
      const { body } = await run(w, [
        {
          method: 'GET',
          url: 'http://crm.example.com/',
          headers: { Authorization: { secret: 'CRM_TOKEN' } },
          retries: 0,
        },
      ]);
      expect(body.conversation).toMatchObject({
        status: 'failed',
        error: { code: 'missing_secret' },
      });
      expect(plain.connections()).toBe(0);
      expect(w.network.resolved()).toEqual([]);
      expect(w.output.text()).toContain('origin_not_allowed');
      expect(w.output.text()).not.toContain(SECRET);
    });

    it.each([
      'https://crm.example.com.evil.example/',
      'https://evilcrm.example.com/',
      'https://sub.crm.example.com/',
      'https://crm.example.com:8443/',
      'https://xn--crm-example-com.example/',
      'http://crm.example.com/',
    ])('el secreto no viaja a %s', async (url) => {
      const w = await world({
        ...CRM_VARIABLES,
        FRANCA_HTTP_ALLOWED_DESTINATIONS: `${P}:80,${P}:8443`,
      });
      const crm = await w.crm(undefined, TLS_CRM);
      const host = new URL(url).hostname;
      w.network.resolve(host, [P]);
      await w.serveAt(P, 8443, { kind: 'respond', status: 200 });
      const { body } = await run(w, [
        {
          method: 'GET',
          url,
          headers: { Authorization: { secret: 'CRM_TOKEN' } },
          retries: 0,
        },
      ]);
      expect(body.conversation).toMatchObject({
        status: 'failed',
        error: { code: 'missing_secret' },
      });
      expect(w.network.connections()).toEqual([]);
      expect(crm.received()).toHaveLength(0);
    });

    it.each([
      'https://CRM.EXAMPLE.COM/x',
      'https://crm.example.com:443/x',
      'https://crm.example.com/x?a=1',
    ])('el mismo origen escrito como %s sí recibe el secreto', async (url) => {
      const w = await world(CRM_VARIABLES);
      const crm = await w.crm(undefined, TLS_CRM);
      const { events } = await run(w, [
        {
          method: 'GET',
          url,
          headers: { Authorization: { secret: 'CRM_TOKEN' } },
          retries: 0,
        },
      ]);
      expect(events[0]).toMatchObject({ status: 201, error: null });
      expect(received(crm)).toEqual(['Bearer prueba-crm-1']);
    });

    it('un secreto de origen http:// llega por http a su par permitido y no a https ni a otro puerto', async () => {
      const w = await world({
        FRANCA_SECRET_LOCAL: 'Bearer prueba-local-1',
        FRANCA_HTTP_SECRET_ORIGINS: 'LOCAL=http://crm.local.test:8080',
        FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080,127.0.0.1:8081',
      });
      w.network.resolve('crm.local.test', ['127.0.0.1']);
      const server = await w.serveAt('127.0.0.1', 8080, {
        kind: 'respond',
        status: 200,
      });
      await w.serveAt('127.0.0.1', 8081, { kind: 'respond', status: 200 });
      const ok = await run(w, [
        {
          method: 'GET',
          url: 'http://crm.local.test:8080/',
          headers: { Authorization: { secret: 'LOCAL' } },
          retries: 0,
        },
      ]);
      expect(ok.events[0]).toMatchObject({ status: 200, error: null });
      expect(received(server)).toEqual(['Bearer prueba-local-1']);
      for (const url of [
        'http://crm.local.test:8081/',
        'https://crm.local.test:8080/',
      ]) {
        const bad = await run(w, [
          {
            method: 'GET',
            url,
            headers: { Authorization: { secret: 'LOCAL' } },
            retries: 0,
          },
        ]);
        expect(bad.body.conversation, url).toMatchObject({
          status: 'failed',
          error: { code: 'missing_secret' },
        });
      }
      expect(server.received()).toHaveLength(1);
    });

    it('un secreto sin origen (FRANCA_SECRET_X) no existe aunque otro nombre sí tenga origen, y el nombre no se confunde por prefijo', async () => {
      const w = await world({
        FRANCA_SECRET_CRM: 'Bearer prueba-crm-corto',
        FRANCA_SECRET_CRM_TOKEN: 'Bearer prueba-crm-1',
        FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=https://crm.example.com',
      });
      const crm = await w.crm(undefined, TLS_CRM);
      const { body } = await run(w, [
        {
          method: 'GET',
          url: 'https://crm.example.com/',
          headers: { Authorization: { secret: 'CRM' } },
          retries: 0,
        },
      ]);
      expect(body.conversation).toMatchObject({
        status: 'failed',
        error: { code: 'missing_secret' },
      });
      expect(crm.received()).toHaveLength(0);
      expect(w.output.text()).toContain('not_configured');
      expect(w.output.text()).not.toContain('prueba-crm-corto');
    });

    /** Cada fallo de red posible con un secreto en la petición: el valor no aparece en nada de lo que sale ni se guarda. */
    it.each([
      [
        'el servidor lee la petición y cierra',
        { kind: 'read-and-close' } as const,
        TLS_CRM,
      ],
      [
        'certificado de otro nombre',
        { kind: 'respond', status: 200 } as const,
        {
          tls: { hostname: 'otro.example.com', authority: 'trusted' },
        } as const,
      ],
      [
        'certificado de una autoridad no confiable',
        { kind: 'respond', status: 200 } as const,
        {
          tls: { hostname: 'crm.example.com', authority: 'untrusted' },
        } as const,
      ],
      [
        '500 que repite la cabecera en el cuerpo',
        {
          kind: 'respond',
          status: 500,
          body: `Authorization: Bearer ${SECRET}`,
        } as const,
        TLS_CRM,
      ],
      [
        'una respuesta que se cuelga',
        { kind: 'stall-headers' } as const,
        TLS_CRM,
      ],
      [
        '101 Switching Protocols',
        { kind: 'switching-protocols' } as const,
        TLS_CRM,
      ],
      [
        'el eco de las cabeceras recibidas',
        { kind: 'echo-headers' } as const,
        TLS_CRM,
      ],
    ])(
      'con un fallo de red (%s) el secreto no sale por ningún canal',
      async (_label, behaviour, tls) => {
        const w = await world(CRM_VARIABLES);
        await w.crm(behaviour, tls);
        await w.ctx.publish(leadsWith({ timeoutMs: 700 }));
        const { id } = await w.ctx.start('captacion-leads');
        await w.ctx.say(id, { text: 'Ana' });
        await w.ctx.say(id, { text: 'ana@example.com' });
        const sent = await w.ctx.say(id, { choice: 'grande' });
        const read = await w.ctx.conv.get(id).expect(200);
        const transcript = await w.ctx.conv.transcript(id).expect(200);
        const rows = await dumpConversationTables(w.ctx.prisma);
        for (const [label, text] of [
          ['avance', JSON.stringify(sent)],
          ['conversación', read.text],
          ['transcripción', transcript.text],
          ['filas', rows],
          ['salida', w.output.text()],
        ] as const) {
          expect(text, label).not.toContain(SECRET);
          expect(text, label).not.toContain('Bearer');
        }
      },
    );

    it('lo que una llamada http no devuelve en el responseMap no se guarda: ni URL, ni cabeceras, ni cuerpo de la petición ni de la respuesta', async () => {
      const w = await world(CRM_VARIABLES);
      await w.crm(
        {
          kind: 'respond',
          status: 201,
          body: '{"id":"L-1","eco":"MARCA-RESPUESTA"}',
        },
        TLS_CRM,
      );
      await w.ctx.publish(
        leadsWith({
          url: 'https://crm.example.com/api/leads?origen=MARCA-URL',
          headers: { 'X-Campana': 'MARCA-CABECERA' },
        }),
      );
      const { id } = await w.ctx.start('captacion-leads');
      await w.ctx.say(id, { text: 'Ana' });
      await w.ctx.say(id, { text: 'ana@example.com' });
      const sent = await w.ctx.say(id, { choice: 'grande' });
      expect(sent.conversation.outcome).toBe('lead-empresa');
      const read = await w.ctx.conv.get(id).expect(200);
      const transcript = await w.ctx.conv.transcript(id).expect(200);
      const rows = await dumpConversationTables(w.ctx.prisma);
      for (const [label, text] of [
        ['avance', JSON.stringify(sent)],
        ['conversación', read.text],
        ['transcripción', transcript.text],
        ['filas', rows],
      ] as const) {
        for (const marker of [
          'MARCA-URL',
          'MARCA-CABECERA',
          'MARCA-RESPUESTA',
          'crm.example.com',
          'api/leads',
          'Bearer',
          'authorization',
          'Authorization',
          'CRM_TOKEN',
          '1.2.3.4',
        ]) {
          expect(text, `${label}: ${marker}`).not.toContain(marker);
        }
      }
    });
  });

  describe('plazo compartido del avance', () => {
    it('si el llm consumió casi todo el plazo de 90 s, el http se recorta al resto aunque su timeoutMs sea de 30 s', async () => {
      const w = await world();
      w.network.resolve('api.example.com', [P]);
      const server = await w.serveAt(
        P,
        443,
        { kind: 'stall-headers' },
        TLS_API,
      );
      await w.ctx.publish(llmHttp({ timeoutMs: 30_000 }));
      w.ctx.testApp.llm.use(() => {
        w.ctx.testApp.clock.advance(89_500);
        return finishing(0.01, 'Hola');
      });
      const started = Date.now();
      const { body } = await w.ctx.start('llm-http');
      const elapsed = Date.now() - started;
      expect(httpEvents(body).map(without)).toEqual([
        { attempts: 1, status: null, error: 'timeout' },
      ]);
      expect(server.received()).toHaveLength(1);
      expect(elapsed).toBeGreaterThanOrEqual(300);
      expect(elapsed).toBeLessThan(500 + TOLERANCE_MS + 500);
      await expect
        .poll(() => server.openConnections(), { timeout: 3000 })
        .toBe(0);
    });

    it('con el plazo ya vencido el http da timeout sin resolver ni conectar (también con una cabecera literal)', async () => {
      const w = await world();
      w.network.resolve('api.example.com', [P]);
      const server = await w.serveAt(
        P,
        443,
        { kind: 'respond', status: 200 },
        TLS_API,
      );
      await w.ctx.publish(llmHttp({ timeoutMs: 5000 }));
      w.ctx.testApp.llm.use(() => {
        w.ctx.testApp.clock.advance(91_000);
        return finishing(0.01, 'Hola');
      });
      const { body } = await w.ctx.start('llm-http');
      expect(httpEvents(body).map(without)).toEqual([
        { attempts: 1, status: null, error: 'timeout' },
      ]);
      expect(w.network.resolutions('api.example.com')).toBe(0);
      expect(server.connections()).toBe(0);
    });
  });
});

describe('QA salida http: datos del usuario en la petición (inyección)', () => {
  let world: HttpWorld | undefined;
  afterEach(async () => {
    const previous = world;
    world = undefined;
    await previous?.close();
  });

  /** Pregunta `nombre` y lo lleva a la ruta, a una cabecera y al cuerpo de un `POST`. */
  const injectionFlow = (): any => ({
    specVersion: '0.1',
    id: 'inyeccion',
    name: 'Inyección',
    variables: [{ name: 'nombre', type: 'string' }],
    start: 'p',
    nodes: [
      {
        id: 'p',
        type: 'input',
        inputType: 'text',
        variable: 'nombre',
        prompt: [{ kind: 'text', text: '¿Nombre?' }],
        next: 'h',
      },
      {
        id: 'h',
        type: 'http',
        request: {
          method: 'POST',
          url: 'https://api.example.com/u/{{nombre}}?q={{nombre}}',
          headers: { 'X-Nombre': '{{nombre}}' },
          body: { n: '{{nombre}}' },
        },
        retries: 0,
        next: 'fin',
        onError: 'fin',
      },
      { id: 'fin', type: 'end', outcome: 'fin' },
    ],
  });

  it.each([
    ['CRLF e inyección de cabecera', 'a\r\nX-Inyectada: 1', false],
    ['LF solo', 'a\nX-Inyectada: 1', false],
    [
      'petición contrabandeada',
      'a HTTP/1.1\r\nHost: evil.example\r\n\r\nGET /robar HTTP/1.1\r\nHost: evil.example\r\n\r\n',
      false,
    ],
    [
      'espacios, barras y escapes',
      'a b/../../x?y=1#z%0d%0aX-Inyectada: 1',
      true,
    ],
    ['NUL', 'a\u0000b', false],
    ['no latin1 en una cabecera', 'a€b', false],
    ['latin1 en una cabecera', 'añb', false],
    ['sustituto suelto', 'a\ud800b', false],
    ['emoji', 'a😀b', false],
    ['tabulador', 'a\tb', true],
    ['comillas y llaves', 'a"b}{\\', true],
  ])(
    '%s: o el motor la rechaza sin llamar al host, o sale una sola petición íntegra sin cabeceras ni líneas inyectadas',
    async (_label, name, sends) => {
      world = await startWorld();
      const w = world;
      w.network.resolve('api.example.com', [P]);
      const server = await w.serveAt(
        P,
        443,
        { kind: 'respond', status: 200 },
        TLS_API,
      );
      await w.ctx.publish(injectionFlow());
      const { id } = await w.ctx.start('inyeccion');
      const response = await w.ctx.conv.send(id, { input: { text: name } });
      expect(
        response.status,
        JSON.stringify(response.body).slice(0, 200),
      ).toBeLessThan(500);
      const requests = server.received();
      expect(requests).toHaveLength(sends ? 1 : 0);
      for (const request of requests) {
        expect(Object.keys(request.headers).sort()).toEqual([
          'accept-encoding',
          'connection',
          'content-length',
          'content-type',
          'host',
          'user-agent',
          'x-nombre',
        ]);
        expect(request.headers.host).toBe('api.example.com');
        expect(request.path.startsWith('/u/')).toBe(true);
        expect(request.path).not.toMatch(/[\r\n\s]/);
        expect(request.headers['x-nombre']).not.toMatch(/[\r\n]/);
        expect(() => JSON.parse(request.body)).not.toThrow();
        expect(Buffer.byteLength(request.body)).toBe(
          Number(request.headers['content-length']),
        );
      }
      expect(
        w.network.connections().every((c) => c.address === P && c.port === 443),
      ).toBe(true);
      expect(
        w.network.resolved().every((host) => host === 'api.example.com'),
      ).toBe(true);
    },
  );
});

describe('QA salida http: URLs con la IP escrita de formas raras (e2e)', () => {
  let world: HttpWorld | undefined;
  afterEach(async () => {
    const previous = world;
    world = undefined;
    await previous?.close();
  });

  it.each([
    'https://2130706433/',
    'https://0x7f000001/',
    'https://0x7f.1/',
    'https://127.1/',
    'https://017700000001/',
    'https://0177.0.0.1/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[64:ff9b::7f00:1]/',
    'https://169.254.169.254/latest/meta-data/',
    'https://0/',
    'https://0.0.0.0/',
    'https://１２７.０.０.１/',
    'https://127。0。0。1/',
    'https://①②⑦.0.0.1/',
    'https://1.2.3.4/',
    'https://[2606:4700:4700::1111]/',
    'https://localhost/',
    'https://LOCALHOST./',
    'https://foo.localhost/',
    'https://crm.example.com@127.0.0.1/',
    'https://127.0.0.1:443@crm.example.com/',
    'https://crm.example.com\\@127.0.0.1/',
    'http://127.0.0.1:8080/',
  ])(
    '%s no resuelve ni conecta: el motor la rechaza, no se publica o el host la bloquea',
    async (url) => {
      world = await startWorld({
        variables: {
          ...CRM_VARIABLES,
          FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080',
        },
      });
      const w = world;
      const flow = httpChain(
        [
          {
            method: 'GET',
            url,
            headers: { Authorization: { secret: 'CRM_TOKEN' } },
            retries: 0,
          },
        ],
        `qa-ip-${(sequence += 1)}`,
      );
      const created = await w.ctx.flows.create(flow);
      let outcome = 'no publicado';
      if (created.status === 201) {
        await w.ctx.flows.publish(flow.id).expect(201);
        const { body } = await w.ctx.start(flow.id);
        outcome = `${body.conversation.status}:${body.conversation.error?.code ?? httpEvents(body)[0]?.error ?? 'sin evento'}`;
      }
      expect(
        [
          'no publicado',
          'ended:invalid_url',
          'failed:missing_secret',
          'ended:blocked',
        ],
        `${url} → ${outcome}`,
      ).toContain(outcome);
      expect(w.network.connections()).toEqual([]);
      expect(w.output.text()).not.toContain(SECRET);
    },
  );
});
