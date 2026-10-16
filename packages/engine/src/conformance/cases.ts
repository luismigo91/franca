import type { AttemptResult } from '../http/result.js';
import type { HttpRequest } from '../types.js';
import { call } from './call.js';
import type { Connection, HostConformanceCase, HostConformanceHarness, ServerBehaviour } from './types.js';

/** Direcciones que usan los casos de bloqueo: ningún servidor del arnés puede escuchar en ellas. */
export const CONFORMANCE_INTERNAL_ADDRESSES: readonly string[] = [
  '127.0.0.1',
  '0.0.0.0',
  '10.0.0.5',
  '172.16.0.1',
  '172.31.255.254',
  '192.168.1.1',
  '100.64.0.1',
  '169.254.169.254',
  '224.0.0.1',
  '255.255.255.255',
  '240.0.0.1',
  '192.0.2.1',
  '198.18.0.1',
  '::1',
  '::',
  'fe80::1',
  'fc00::1',
  'fd12:3456::1',
  'ff02::1',
  '2001:db8::1',
  '::ffff:127.0.0.1',
  '::ffff:10.0.0.5',
  // las mismas escritas de otra forma, para un host que compara cadenas en vez de direcciones
  '::ffff:7f00:1',
  '0:0:0:0:0:0:0:1',
  '0000:0000:0000:0000:0000:0000:0000:0001',
];

const MARKER_SECRET = 'ZQXJ-CONFORMANCIA-SECRETO-5d2e';
const MARKER_PII = 'ZQXJ-conformancia-pii@example.com';
const MIB = 1048576;

const request = (url: string, overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  nodeId: 'conformancia',
  method: 'GET',
  url,
  headers: [],
  body: null,
  timeoutMs: 2000,
  attempt: 1,
  containsPii: false,
  ...overrides,
});

const samePair = (a: Connection, b: { address: string; port: number }): boolean => a.address === b.address && a.port === b.port;

const kindOf = (result: AttemptResult | null): string => (result === null ? 'sin resultado' : result.kind);

/** Anota un fallo si el resultado no es de uno de los `kinds`. */
function expectKind(failures: string[], label: string, result: AttemptResult | null, ...kinds: AttemptResult['kind'][]): void {
  if (result === null || !kinds.includes(result.kind)) {
    failures.push(`${label}: se esperaba ${kinds.join(' o ')} y llegó ${kindOf(result)}`);
  }
}

async function serveAndCall(
  harness: HostConformanceHarness,
  behaviour: ServerBehaviour,
  label: string,
  overrides: Partial<HttpRequest> = {},
  options?: Parameters<HostConformanceHarness['serve']>[1],
) {
  const server = await harness.serve(behaviour, options);
  const outcome = await call(harness, request(`${server.origin}/`, overrides), label);
  return { server, ...outcome };
}

const destinosInternos: HostConformanceCase = {
  id: 'destinos-internos',
  requirement: 'Host de producción: destinos de red',
  scenario: 'Dominios que resuelven a direcciones internas',
  async run(harness) {
    const failures: string[] = [];
    for (const [index, address] of CONFORMANCE_INTERNAL_ADDRESSES.entries()) {
      const name = `interna-${index}.conformance.test`;
      await harness.resolve(name, [[address]]);
      const outcome = await call(harness, request(`http://${name}:${harness.blockedPort}/`), `dirección interna nº ${index}`);
      failures.push(...outcome.failures);
      if (outcome.failures.length === 0) expectKind(failures, `dirección interna nº ${index}`, outcome.result, 'blocked');
    }
    const connections = await harness.connectionsTo();
    if (connections.some((c) => CONFORMANCE_INTERNAL_ADDRESSES.includes(c.address) || c.port === harness.blockedPort)) {
      failures.push('el host abrió una conexión con una dirección interna');
    }
    return failures;
  },
};

const cambioDeResolucion: HostConformanceCase = {
  id: 'cambio-de-resolucion',
  requirement: 'Host de producción: destinos permitidos y resolución',
  scenario: 'Cambio de resolución entre comprobación y conexión',
  async run(harness) {
    const failures: string[] = [];
    const a = await harness.serve({ kind: 'respond', status: 200, body: 'A' });
    await harness.resolve('rebind.conformance.test', [[a.address], ['127.0.0.1']]);
    for (const round of [1, 2]) {
      const outcome = await call(harness, request(`http://rebind.conformance.test:${a.port}/`), `resolución nº ${round}`);
      failures.push(...outcome.failures);
      if (outcome.failures.length === 0) expectKind(failures, `resolución nº ${round}`, outcome.result, 'response', 'blocked');
    }
    const connections = await harness.connectionsTo();
    if (connections.some((c) => samePair(c, { address: '127.0.0.1', port: a.port }))) {
      failures.push('el host conectó con 127.0.0.1 tras un cambio de resolución');
    }
    return failures;
  },
};

const resolucionMezclada: HostConformanceCase = {
  id: 'resolucion-mezclada',
  requirement: 'Host de producción: destinos permitidos y resolución',
  scenario: 'Resolución con respuestas mezcladas',
  async run(harness) {
    const failures: string[] = [];
    const a = await harness.serve({ kind: 'respond', status: 200, body: 'A' });
    const refused = await harness.refusing();
    const rounds: { name: string; answers: string[]; port: number; accepted: AttemptResult['kind'][] }[] = [
      { name: 'mezcla-1.conformance.test', answers: [a.address, '127.0.0.1'], port: a.port, accepted: ['response', 'blocked'] },
      { name: 'mezcla-2.conformance.test', answers: ['127.0.0.1', a.address], port: a.port, accepted: ['response', 'blocked'] },
      { name: 'mezcla-3.conformance.test', answers: [refused.address, '127.0.0.1'], port: refused.port, accepted: ['blocked', 'network_error'] },
    ];
    for (const [index, round] of rounds.entries()) {
      await harness.resolve(round.name, [round.answers]);
      const label = `ronda mezclada nº ${index + 1}`;
      const outcome = await call(harness, request(`http://${round.name}:${round.port}/`), label);
      failures.push(...outcome.failures);
      if (outcome.failures.length === 0) expectKind(failures, label, outcome.result, ...round.accepted);
      const connections = await harness.connectionsTo();
      if (connections.some((c) => samePair(c, { address: '127.0.0.1', port: round.port }))) {
        failures.push(`${label}: el host conectó con 127.0.0.1 en el puerto permitido`);
      }
    }
    return failures;
  },
};

const redireccion: HostConformanceCase = {
  id: 'redireccion',
  requirement: 'Host de producción: redirecciones y credenciales propias',
  scenario: 'Redirección a un destino interno',
  async run(harness) {
    const failures: string[] = [];
    const toInternal = await serveAndCall(harness, { kind: 'redirect', status: 302, location: `http://127.0.0.1:${harness.blockedPort}/` }, 'redirección a una dirección interna');
    failures.push(...toInternal.failures);
    if (toInternal.result?.kind !== 'response' || toInternal.result.status !== 302) failures.push('la redirección a una dirección interna debía entregarse como respuesta 302');
    if ((await toInternal.server.received()).length !== 1) failures.push('el servidor debía recibir exactamente una petición');
    const target = await harness.serve({ kind: 'respond', status: 200 });
    const toPermitted = await serveAndCall(harness, { kind: 'redirect', status: 302, location: `${target.origin}/` }, 'redirección a un destino permitido');
    failures.push(...toPermitted.failures);
    if (toPermitted.result?.kind !== 'response' || toPermitted.result.status !== 302) failures.push('la redirección a un destino permitido debía entregarse como respuesta 302');
    if ((await target.received()).length !== 0) failures.push('el host siguió una redirección');
    const connections = await harness.connectionsTo();
    if (connections.some((c) => c.port === harness.blockedPort)) failures.push('el host siguió una redirección hacia una dirección interna');
    return failures;
  },
};

const cookies: HostConformanceCase = {
  id: 'cookies',
  requirement: 'Host de producción: redirecciones y credenciales propias',
  scenario: 'Cookies de una respuesta anterior',
  async run(harness) {
    const failures: string[] = [];
    const server = await harness.serve({ kind: 'set-cookie', cookie: 's=1' });
    for (const round of [1, 2]) {
      const outcome = await call(harness, request(`${server.origin}/`), `petición nº ${round}`);
      failures.push(...outcome.failures);
    }
    const received = await server.received();
    if (received.length !== 2) failures.push('el servidor debía recibir dos peticiones');
    else if (received[1]!.headers['cookie'] !== undefined) failures.push('la segunda petición llevaba una cabecera cookie');
    return failures;
  },
};

const tlsInvalido: HostConformanceCase = {
  id: 'tls-invalido',
  requirement: 'Host de producción: redirecciones y credenciales propias',
  scenario: 'Certificado no válido',
  async run(harness) {
    const failures: string[] = [];
    const outcome = await serveAndCall(harness, { kind: 'respond', status: 200 }, 'https con un certificado no confiable', {}, { tls: 'untrusted' });
    failures.push(...outcome.failures);
    if (outcome.result?.kind !== 'network_error' || outcome.result.requestSent !== false) failures.push('se esperaba network_error con requestSent false');
    if ((await outcome.server.received()).length !== 0) failures.push('el servidor recibió una petición a pesar del certificado no válido');
    return failures;
  },
};

const cuerpoSinFin: HostConformanceCase = {
  id: 'cuerpo-sin-fin',
  requirement: 'Host de producción: tamaño de la respuesta',
  scenario: 'Cuerpo sin fin',
  async run(harness) {
    const failures: string[] = [];
    const outcome = await serveAndCall(harness, { kind: 'endless-body', encoding: 'identity' }, 'cuerpo sin fin', { timeoutMs: 5000 });
    failures.push(...outcome.failures);
    if (outcome.failures.length === 0) {
      expectKind(failures, 'cuerpo sin fin', outcome.result, 'response_too_large');
      if (outcome.elapsedMs >= 5000) failures.push('response_too_large llegó después de que venciera el tiempo');
    }
    return failures;
  },
};

const cuerpoComprimidoSinFin: HostConformanceCase = {
  id: 'cuerpo-comprimido-sin-fin',
  requirement: 'Host de producción: tamaño de la respuesta',
  scenario: 'Cuerpo comprimido sin fin',
  async run(harness) {
    const failures: string[] = [];
    for (const encoding of ['gzip', 'deflate', 'br', 'x-franca-test'] as const) {
      const label = `cuerpo sin fin con ${encoding}`;
      const outcome = await serveAndCall(harness, { kind: 'endless-body', encoding }, label, { timeoutMs: 5000 });
      failures.push(...outcome.failures);
      if (outcome.failures.length > 0) continue;
      expectKind(failures, label, outcome.result, 'response_too_large');
      if (outcome.elapsedMs >= 5000) failures.push(`${label}: response_too_large llegó después de que venciera el tiempo`);
    }
    return failures;
  },
};

const bombaDescompresion: HostConformanceCase = {
  id: 'bomba-descompresion',
  requirement: 'Host de producción: tamaño de la respuesta',
  scenario: 'Bomba de descompresión',
  async run(harness) {
    const failures: string[] = [];
    for (const encoding of ['gzip', 'deflate', 'br'] as const) {
      const label = `bomba de 2 MiB con ${encoding}`;
      const outcome = await serveAndCall(harness, { kind: 'compressed-body', encoding, decompressedBytes: 2 * MIB }, label);
      failures.push(...outcome.failures);
      if (outcome.failures.length === 0) expectKind(failures, label, outcome.result, 'response_too_large');
    }
    const exact = await serveAndCall(harness, { kind: 'compressed-body', encoding: 'gzip', decompressedBytes: MIB }, 'cuerpo comprimido de 1 MiB exacto');
    failures.push(...exact.failures);
    if (exact.result?.kind !== 'response' || exact.result.status !== 200 || exact.result.body.length !== MIB) {
      failures.push('un cuerpo que descomprime a 1 MiB justos debía entregarse íntegro con status 200');
    }
    return failures;
  },
};

/** Un caso de tiempo: el servidor se comporta como `behaviour` y el host debe dar `timeout` en [500, 500 + tolerancia]. */
function timeoutCase(id: string, scenario: string, behaviour: ServerBehaviour): HostConformanceCase {
  return {
    id,
    requirement: 'Host de producción: tiempo por intento',
    scenario,
    async run(harness) {
      const failures: string[] = [];
      const outcome = await serveAndCall(harness, behaviour, scenario, { timeoutMs: 500 });
      failures.push(...outcome.failures);
      if (outcome.failures.length > 0) return failures;
      expectKind(failures, scenario, outcome.result, 'timeout');
      if (outcome.elapsedMs < 500) failures.push(`${scenario}: el timeout llegó antes de los 500 ms`);
      if (outcome.elapsedMs > 500 + harness.timeToleranceMs) failures.push(`${scenario}: el timeout llegó después de 500 ms más la tolerancia`);
      return failures;
    },
  };
}

const conexionRechazada: HostConformanceCase = {
  id: 'conexion-rechazada',
  requirement: 'Host de producción: fallos de conexión',
  scenario: 'Conexión rechazada',
  async run(harness) {
    const failures: string[] = [];
    const refused = await harness.refusing();
    const outcome = await call(harness, request(`${refused.origin}/`), 'conexión rechazada');
    failures.push(...outcome.failures);
    if (outcome.failures.length === 0 && (outcome.result?.kind !== 'network_error' || outcome.result.requestSent !== false)) {
      failures.push('se esperaba network_error con requestSent false');
    }
    return failures;
  },
};

const secretHeaders = [{ name: 'Authorization', secret: 'CONFORMANCE_TOKEN' }];

const secretoASuOrigen: HostConformanceCase = {
  id: 'secreto-a-su-origen',
  requirement: 'Host de producción: secretos',
  scenario: 'Secreto enviado a su origen',
  async run(harness) {
    const failures: string[] = [];
    const server = await harness.serve({ kind: 'respond', status: 204 });
    await harness.setSecret('CONFORMANCE_TOKEN', MARKER_SECRET, [server.origin]);
    const outcome = await call(harness, request(`${server.origin}/`, { headers: secretHeaders }), 'secreto a su origen');
    failures.push(...outcome.failures);
    if (outcome.failures.length === 0 && (outcome.result?.kind !== 'response' || outcome.result.status !== 204 || outcome.result.body !== '')) {
      failures.push('se esperaba una respuesta 204 sin cuerpo');
    }
    const received = await server.received();
    if (received[0]?.headers['authorization'] !== MARKER_SECRET) failures.push('el servidor no recibió el valor del secreto en Authorization');
    if (JSON.stringify(outcome.result).includes(MARKER_SECRET)) failures.push('el resultado contiene el valor del secreto');
    if ((await harness.logs()).some((line) => line.includes(MARKER_SECRET))) failures.push('los registros contienen el valor del secreto');
    return failures;
  },
};

const secretoOrigenNoAutorizado: HostConformanceCase = {
  id: 'secreto-origen-no-autorizado',
  requirement: 'Host de producción: secretos',
  scenario: 'Secreto enviado a un origen no autorizado',
  async run(harness) {
    const failures: string[] = [];
    const authorized = await harness.serve({ kind: 'respond', status: 200 }, { tls: 'trusted' });
    const other = await harness.serve({ kind: 'respond', status: 200 }, { tls: 'trusted' });
    await harness.setSecret('CONFORMANCE_TOKEN', MARKER_SECRET, [authorized.origin]);
    const withoutTls = authorized.origin.startsWith('https:') ? `http:${authorized.origin.slice('https:'.length)}` : authorized.origin;
    for (const [label, url] of [['otro origen', `${other.origin}/`], ['mismo host sin TLS', `${withoutTls}/`]] as const) {
      const outcome = await call(harness, request(url, { headers: secretHeaders }), label);
      failures.push(...outcome.failures);
      if (outcome.failures.length === 0) expectKind(failures, label, outcome.result, 'missing_secret');
    }
    if ((await harness.connectionsTo()).length !== 0) failures.push('el host abrió una conexión con un origen no autorizado para el secreto');
    if ((await other.received()).length !== 0) failures.push('un origen no autorizado recibió la petición');
    return failures;
  },
};

const secretoOtroTenant: HostConformanceCase = {
  id: 'secreto-otro-tenant',
  requirement: 'Host de producción: secretos',
  scenario: 'Secreto de otro tenant',
  async run(harness) {
    const failures: string[] = [];
    const server = await harness.serve({ kind: 'respond', status: 200 });
    await harness.setSecret('CONFORMANCE_TOKEN', MARKER_SECRET, [server.origin], 'tenant-b');
    const outcome = await call(harness, request(`${server.origin}/`, { headers: secretHeaders }), 'secreto de otro tenant', harness.http('tenant-a'));
    failures.push(...outcome.failures);
    if (outcome.failures.length === 0) expectKind(failures, 'secreto de otro tenant', outcome.result, 'missing_secret');
    if ((await server.received()).length !== 0) failures.push('el servidor recibió una petición con el secreto de otro tenant');
    return failures;
  },
};

const registrosPii: HostConformanceCase = {
  id: 'registros-pii',
  requirement: 'Host de producción: registros',
  scenario: 'Petición con datos personales',
  async run(harness) {
    const failures: string[] = [];
    const server = await harness.serve({ kind: 'respond', status: 200, body: '{}' });
    const outcome = await call(
      harness,
      request(`${server.origin}/?e=${encodeURIComponent(MARKER_PII)}`, {
        method: 'POST',
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        body: JSON.stringify({ e: MARKER_PII }),
        containsPii: true,
      }),
      'petición con datos personales',
    );
    failures.push(...outcome.failures);
    const logs = await harness.logs();
    if (logs.some((line) => line.includes(MARKER_PII) || line.includes(encodeURIComponent(MARKER_PII)))) {
      failures.push('los registros contienen datos personales de una petición con containsPii');
    }
    return failures;
  },
};

/** Un caso por escenario de los requisitos «Host de producción: …» de la spec, con sus títulos exactos. */
export const HOST_CONFORMANCE_CASES: readonly HostConformanceCase[] = [
  destinosInternos,
  cambioDeResolucion,
  resolucionMezclada,
  redireccion,
  cookies,
  tlsInvalido,
  cuerpoSinFin,
  cuerpoComprimidoSinFin,
  bombaDescompresion,
  timeoutCase('servidor-a-medias', 'Servidor que se queda a medias', { kind: 'stall-body' }),
  timeoutCase('servidor-no-responde', 'Servidor que no responde', { kind: 'stall-headers' }),
  timeoutCase('servidor-muy-lento', 'Servidor que escribe muy despacio', { kind: 'drip-body', intervalMs: 50 }),
  conexionRechazada,
  secretoASuOrigen,
  secretoOrigenNoAutorizado,
  secretoOtroTenant,
  registrosPii,
];
