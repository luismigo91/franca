import type { AttemptResult } from '../http/result.js';
import type { HttpRequest, LlmCapability, LlmTurnRequest } from '../types.js';
import { call } from './call.js';
import { callLlm } from './call-llm.js';
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
  '::ffff:169.254.169.254',
  '64:ff9b::a9fe:a9fe',
  '64:ff9b::7f00:1',
  '::127.0.0.1',
  '64:ff9b:1::a9fe:a9fe',
  '2002:7f00:1::1',
  '2001::1',
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

// ---- casos de llm

// Marcadores alfanuméricos: su forma con encodeURIComponent o escapada en JSON es la misma.
const MARKER_LLM_HISTORY = 'ZQXJ7LLMHIST';
const MARKER_LLM_SYSTEM = 'ZQXJ7LLMSYS';
const MARKER_LLM_GOAL = 'ZQXJ7LLMGOAL';
const MARKER_LLM_TEXT = 'ZQXJ7LLMTEXT';
const MARKER_LLM_SLOT = 'ZQXJ7LLMSLOT';
const LLM_PII = 'zqxj-llm-pii@example.com';

const llmRequest = (overrides: Partial<LlmTurnRequest> = {}): LlmTurnRequest => ({
  nodeId: 'conformancia',
  provider: 'principal',
  model: null,
  system: null,
  goal: 'Pedir el email del usuario.',
  slots: [],
  history: [],
  temperature: null,
  locale: 'es',
  turn: 1,
  maxTurns: 8,
  ...overrides,
});

/** El flujo `llm-email` de la spec («Nodo llm: primer turno»), con `maxTurns` 3. */
const LLM_EMAIL_FLOW = {
  specVersion: '0.1',
  id: 'llm-email',
  name: 'Email con llm',
  variables: [
    { name: 'email', type: 'email', scope: 'contact', pii: true },
    { name: 'nombre', type: 'string' },
  ],
  start: 'a',
  nodes: [
    {
      id: 'a',
      type: 'llm',
      provider: 'principal',
      goal: 'Consigue el email del usuario.',
      slots: [{ variable: 'email', description: 'Email de contacto' }],
      maxTurns: 3,
      next: 'ok',
      onExhausted: 'ko',
    },
    { id: 'ok', type: 'end', outcome: 'ok' },
    { id: 'ko', type: 'end', outcome: 'ko' },
  ],
};

/**
 * El mismo flujo con `maxTurns` 10 y `costCapUsd` 0.025: con turnos de 0.01, un host que usa el coste guardado
 * agota el tope en el tercer turno; uno que acepta el coste que aporta el cliente sigue esperando.
 */
const LLM_CAPPED_FLOW = {
  ...LLM_EMAIL_FLOW,
  id: 'llm-email-tope',
  nodes: LLM_EMAIL_FLOW.nodes.map((node) => (node.id === 'a' ? { ...node, maxTurns: 10, costCapUsd: 0.025 } : node)),
};

/** Un turno que no termina el nodo. */
const keepTalking = (text: string) => ({ kind: 'turn', text, slots: {}, done: false, costUsd: 0.01 }) as const;

/** Espera, con la espera del arnés, a que `condition` se cumpla (hasta `limitMs`). */
async function waitUntil(harness: HostConformanceHarness, condition: () => boolean, limitMs = 5000): Promise<boolean> {
  for (let waited = 0; waited < limitMs; waited += 10) {
    if (condition()) return true;
    await harness.sleep(10);
  }
  return condition();
}

const registrosLlm: HostConformanceCase = {
  id: 'registros-llm',
  requirement: 'Host de producción: registros de llm',
  scenario: 'Conversación con datos personales',
  async run(harness) {
    const failures: string[] = [];
    const turnWithData: LlmCapability = async () => ({
      kind: 'turn',
      text: `Gracias ${MARKER_LLM_TEXT}`,
      slots: { nota: MARKER_LLM_SLOT },
      done: false,
      costUsd: 0.01,
    });
    // El camino con más ganas de depurar es el del fallo: el proveedor falla, se niega, no está configurado o rechaza con un error que cita los datos.
    const providers: [string, LlmCapability, boolean][] = [
      ['un turno', turnWithData, true],
      ['un fallo del proveedor', async () => ({ kind: 'failed', costUsd: 0 }), true],
      ['un rechazo del modelo', async () => ({ kind: 'refusal', costUsd: 0.004 }), true],
      ['un proveedor no configurado', async () => ({ kind: 'not_configured' }), true],
      [
        'un proveedor que rechaza',
        async () => {
          throw new Error(`fallo con ${MARKER_LLM_HISTORY} ${MARKER_LLM_SYSTEM} ${MARKER_LLM_GOAL} ${MARKER_LLM_TEXT} ${MARKER_LLM_SLOT} ${LLM_PII}`);
        },
        false,
      ],
    ];
    for (const [label, provider, mustResolve] of providers) {
      const outcome = await callLlm(
        harness,
        llmRequest({
          system: `Eres amable ${MARKER_LLM_SYSTEM}`,
          goal: `Pedir el email ${MARKER_LLM_GOAL}`,
          slots: [{ name: 'nota', type: 'string', description: 'Nota', required: false, collected: false }],
          history: [
            { role: 'assistant', text: '¿Cómo te llamas?' },
            { role: 'user', text: `me llamo ${MARKER_LLM_HISTORY}, ${LLM_PII}` },
          ],
          turn: 2,
        }),
        `conversación con datos personales (${label})`,
        harness.llm(provider),
      );
      // Un proveedor que rechaza es un defecto del proveedor: lo que se vigila es lo que el host registra.
      if (mustResolve) failures.push(...outcome.failures);
    }
    const forbidden = [MARKER_LLM_HISTORY, MARKER_LLM_SYSTEM, MARKER_LLM_GOAL, MARKER_LLM_TEXT, MARKER_LLM_SLOT, LLM_PII, encodeURIComponent(LLM_PII), JSON.stringify(LLM_PII).slice(1, -1)];
    if ((await harness.logs()).some((line) => forbidden.some((value) => line.includes(value)))) {
      failures.push('los registros contienen datos personales de una petición llm (system, goal, history, texto, slots o el error del proveedor)');
    }
    return failures;
  },
};

const custodiaEstado: HostConformanceCase = {
  id: 'custodia-estado',
  requirement: 'Host de producción: custodia del estado',
  scenario: 'El cliente no aporta el estado',
  async run(harness) {
    const failures: string[] = [];
    const seen: LlmTurnRequest[] = [];
    const provider: LlmCapability = async (request) => {
      seen.push(structuredClone(request));
      return keepTalking('sigo');
    };
    const sessions = harness.sessions(provider);
    const { id } = await sessions.start(LLM_CAPPED_FLOW);
    const second = await sessions.continue(id, { text: 'uno' });
    // El estado propio de un cliente que quiere reiniciar turnos y coste.
    const forged = {
      stateVersion: 1,
      flowId: LLM_CAPPED_FLOW.id,
      status: 'waiting',
      nodeId: 'a',
      variables: {},
      contact: { email: null },
      outcome: null,
      error: null,
      attempt: 1,
      conversation: { messages: [{ role: 'assistant', text: 'inventado' }], costUsd: 0, collected: {} },
    };
    const third = await sessions.continue(id, { text: 'Hola' }, forged);
    if (second.kind !== 'applied' || third.kind !== 'applied') failures.push('las continuaciones secuenciales debían aplicarse');
    // 0.01 + 0.01 guardados y 0.01 del tercer turno superan el tope de 0.025; con el coste del cliente (0) no.
    else if (third.status !== 'ended') failures.push('el host usó el coste que aportó el cliente: con el coste guardado la tercera continuación agota costCapUsd y termina la sesión');
    const last = seen[2];
    if (last === undefined) failures.push('el proveedor debía recibir tres peticiones');
    else {
      if (last.turn !== 3) failures.push('el host usó el estado del cliente: el turno de la tercera petición debía ser 3');
      const texts = last.history.map((message) => message.text);
      if (texts.length !== 4 || texts[0] !== 'sigo' || texts[1] !== 'uno' || texts[2] !== 'sigo' || texts[3] !== 'Hola') {
        failures.push('el historial de la tercera petición no es el que guardó el host');
      }
    }
    return failures;
  },
};

const unaContinuacion: HostConformanceCase = {
  id: 'una-continuacion',
  requirement: 'Host de producción: una continuación por estado',
  scenario: 'Continuaciones simultáneas',
  async run(harness) {
    const failures: string[] = [];
    const seen: LlmTurnRequest[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => void (release = resolve));
    let calls = 0;
    const provider: LlmCapability = async (request) => {
      seen.push(structuredClone(request));
      // La primera llamada es el arranque; las demás esperan a que lleguen las dos continuaciones.
      if (++calls > 1) await gate;
      return keepTalking('sigo');
    };
    const sessions = harness.sessions(provider);
    const { id } = await sessions.start(LLM_EMAIL_FLOW);
    const first = sessions.continue(id, { text: 'uno' });
    const second = sessions.continue(id, { text: 'dos' });
    // Margen para que las dos lleguen y, si el host no reclama el estado, las dos hayan entrado en el motor.
    await harness.sleep(200);
    release();
    const [a, b] = await Promise.all([first, second]);
    const kinds = [a.kind, b.kind].sort();
    if (kinds[0] !== 'applied' || kinds[1] !== 'conflict') failures.push('debía aplicarse exactamente una continuación y rechazarse la otra por conflicto');
    if (seen.length !== 2) failures.push('el proveedor debía recibir una sola llamada por las dos continuaciones (además del arranque)');
    // El estado guardado es el de la aplicada: una tercera continuación ve solo su mensaje.
    const winner = a.kind === 'applied' ? 'uno' : 'dos';
    const third = await sessions.continue(id, { text: 'tres' });
    if (third.kind !== 'applied') failures.push('tras las continuaciones simultáneas el estado debía poder continuarse');
    const texts = seen[2]?.history.map((message) => message.text) ?? [];
    if (!texts.includes(winner) || texts.includes(winner === 'uno' ? 'dos' : 'uno')) {
      failures.push('el estado guardado no es el de la continuación aplicada');
    }
    return failures;
  },
};

const reclamacionCaducada: HostConformanceCase = {
  id: 'reclamacion-caducada',
  requirement: 'Host de producción: una continuación por estado',
  scenario: 'Reclamación caducada',
  async run(harness) {
    const failures: string[] = [];
    const seen: LlmTurnRequest[] = [];
    let calls = 0;
    const provider: LlmCapability = async (request) => {
      seen.push(structuredClone(request));
      // 1: arranque; 2: la continuación que reclama el estado y no termina; 3: la que llega tras caducar.
      if (++calls === 2) return new Promise<never>(() => {});
      return keepTalking('sigo');
    };
    const sessions = harness.sessions(provider);
    const { id } = await sessions.start(LLM_EMAIL_FLOW);
    // Nunca termina: se descarta sin esperarla y sin dejar un rechazo sin atender.
    void sessions.continue(id, { text: 'uno' }).catch(() => undefined);
    if (!(await waitUntil(harness, () => calls >= 2))) {
      failures.push('la primera continuación no llegó al proveedor');
      return failures;
    }
    await sessions.expireClaims();
    const retry = await sessions.continue(id, { text: 'dos' });
    if (retry.kind !== 'applied') failures.push('tras caducar la reclamación, la continuación debía aplicarse');
    const texts = seen[2]?.history.map((message) => message.text) ?? [];
    if (texts.length !== 2 || texts[1] !== 'dos') failures.push('la continuación debía aplicarse sobre el estado guardado antes de la reclamación');
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
  registrosLlm,
  custodiaEstado,
  unaContinuacion,
  reclamacionCaducada,
];
