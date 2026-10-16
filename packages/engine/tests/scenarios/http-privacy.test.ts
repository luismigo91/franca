import { afterEach, describe, expect, it, vi } from 'vitest';
import { continueSession } from '../../src/index.js';
import { flowOf, httpNode, setNode, variable } from '../helpers/flows.js';
import { LEAK_VARIANTS, always, respond, scriptedHost, secretLeakingHost, throwingHost, type ScriptedHost } from '../helpers/http-host.js';
import { continueWith, faq, httpFlow, leadsAtSize, runOk, withValue } from '../helpers/http-flow.js';

const MARKER = 'ZQXJ-SECRETO-9f31c0';
const PII = 'ZQXJ-PII-77ab42@example.com';

const snapshot = (result: Awaited<ReturnType<typeof runOk>>, host: ScriptedHost) => ({
  requests: JSON.stringify(host.requests),
  events: JSON.stringify(result.events),
  state: JSON.stringify(result.state),
});

describe('Privacidad de la llamada http', () => {
  it('Datos personales en la petición', async () => {
    const email = withValue('email', 'ana@example.com', { pii: true });
    const inUrl = await runOk(httpFlow({ url: 'http://localhost/?e={{email}}' }, {}, { variables: [email] }), always(respond(404)).host);
    expect(JSON.stringify(inUrl.events)).not.toContain('ana@example.com');
    const inBody = await runOk(httpFlow({ method: 'POST', body: { e: '{{email}}' } }, {}, { variables: [email] }), always(respond(404)).host);
    expect(JSON.stringify(inBody.events)).not.toContain('ana@example.com');
  });

  it('Respuesta no mapeada', async () => {
    const body = '{"id": "T-1", "eco": "SECRETO-ECO"}';
    const result = await runOk(
      httpFlow({}, { responseMap: [{ variable: 'ticket', pointer: '/id' }] }, { variables: [variable('ticket')] }),
      always(respond(200, body)).host,
    );
    expect(JSON.stringify(result.events)).not.toContain('SECRETO-ECO');
    expect(JSON.stringify(result.state)).not.toContain('SECRETO-ECO');
    expect(result.state.variables.ticket).toBe('T-1');
  });

  it('Valor de un secreto devuelto por el host', async () => {
    for (const variant of LEAK_VARIANTS) {
      const host = secretLeakingHost(MARKER, variant);
      const result = await runOk(httpFlow({ headers: { Authorization: { secret: 'CRM_TOKEN' } } }, { retries: 2 }), host.host);
      const seen = snapshot(result, host);
      expect(host.requests.length, variant).toBeGreaterThan(0);
      expect(seen.requests, `${variant}: petición`).not.toContain(MARKER);
      expect(seen.events, `${variant}: eventos`).not.toContain(MARKER);
      expect(seen.state, `${variant}: estado`).not.toContain(MARKER);
    }
  });

  it('el valor del secreto tampoco llega en un error del host que lanza de forma síncrona', async () => {
    const thrown = throwingHost(new Error(`Authorization: ${MARKER}`));
    const result = await runOk(httpFlow({ headers: { Authorization: { secret: 'CRM_TOKEN' } } }), thrown.host);
    expect(JSON.stringify([result.events, result.state])).not.toContain(MARKER);
  });

  it('en el ejemplo de captación: un 500 con el marcador en el cuerpo no llega a eventos ni estado', async () => {
    const { flow, state } = await leadsAtSize();
    const host = always(respond(500, `{"eco":"${MARKER}"}`));
    const result = await continueWith(flow, state, { choice: 'grande' }, host.host);
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it('datos personales en la URL y el body: ni eventos ni error del estado los contienen', async () => {
    const flow = httpFlow(
      { method: 'POST', url: 'https://api.example.com/?e={{email}}', body: { e: '{{email}}' } },
      { retries: 1 },
      { variables: [withValue('email', PII, { pii: true })] },
    );
    for (const host of [secretLeakingHost(PII, 'body500'), secretLeakingHost(PII, 'throws'), secretLeakingHost(PII, 'rejects'), secretLeakingHost(PII, 'extra200'), secretLeakingHost(PII, 'malformed')]) {
      const result = await runOk(flow, host.host);
      expect(JSON.stringify(result.events)).not.toContain(PII);
      expect(JSON.stringify(result.state.error)).not.toContain(PII);
      expect(JSON.stringify(result.state.error)).not.toContain(encodeURIComponent(PII));
    }
  });

  it('el evento http y los errores son textos fijos: no incluyen la URL ni las cabeceras', async () => {
    const flow = httpFlow({ url: 'https://api.example.com/secreto-en-la-ruta', headers: { 'X-Token': 'valor-de-cabecera' } });
    const result = await runOk(flow, always({ kind: 'missing_secret' }).host);
    const text = JSON.stringify(result.events);
    expect(text).not.toContain('secreto-en-la-ruta');
    expect(text).not.toContain('valor-de-cabecera');
  });
});

describe('Indicador de datos personales', () => {
  const variables = [variable('email', { pii: true }), variable('segmento')];
  const piiOf = async (request: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const host = always(respond(200, '{}'));
    await runOk(httpFlow(request, extra, { variables }), host.host);
    return host.requests[0]!.containsPii;
  };

  it('Plantillas con y sin variables pii', async () => {
    expect(await piiOf({ method: 'POST', body: { s: '{{segmento}}' } })).toBe(false);
    expect(await piiOf({ headers: { 'X-Email': '{{email}}' } })).toBe(true);
    expect(await piiOf({}, { responseMap: [{ variable: 'email', pointer: '/e' }] })).toBe(false);
  });

  it('Variables derivadas de una pii con set', async () => {
    const make = (template: string) =>
      flowOf(
        [
          setNode('s', [['saludo', 'Hola {{email}}'], ['copia', '{{saludo}}'], ['fijo', 'sin datos']], 'h'),
          httpNode('h', { method: 'POST', body: { t: template } }, { next: 'fin', onError: 'fin' }),
          { id: 'fin', type: 'end' },
        ],
        { variables: [variable('email', { pii: true }), variable('saludo'), variable('copia'), variable('fijo')] },
      );
    for (const [template, expected] of [['{{copia}}', true], ['{{fijo}}', false]] as const) {
      const host = always(respond(200));
      await runOk(make(template), host.host);
      expect(host.requests[0]!.containsPii, template).toBe(expected);
    }
  });
});

describe('Ejecución determinista con host', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Dos ejecuciones con el mismo guion de host', async () => {
    const { flow, state } = await leadsAtSize();
    const hosts = [scriptedHost([respond(429), respond(201)]), scriptedHost([respond(429), respond(201)])];
    const results = [];
    for (const host of hosts) results.push(await continueSession({ flow, state, input: { choice: 'grande' } }, host.host));
    expect(results[0]).toEqual(results[1]);
    expect(hosts[0]!.requests).toEqual(hosts[1]!.requests);
    expect(hosts[0]!.requests).toHaveLength(2);
  });

  it('Sin escritura en consola con http', async () => {
    const spies = (Object.keys(console) as (keyof Console)[])
      .filter((key) => typeof console[key] === 'function')
      .map((key) => vi.spyOn(console, key as 'log').mockImplementation(() => {}));
    const flow = httpFlow({ headers: { Authorization: { secret: 'S' } } }, { retries: 1 });
    await runOk(flow, always(respond(200)).host); // éxito
    await runOk(flow, always(respond(503)).host); // error
    await runOk(flow, throwingHost().host); // host que lanza
    await runOk(flow, always({ kind: 'missing_secret' }).host);
    await runOk(httpFlow({ url: 'http://localhost/' }), always(respond(200)).host); // petición no construida
    expect(spies.length).toBeGreaterThan(5);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('Ejemplo de FAQ con IA', async () => {
    const host = always(respond(200));
    const result = await runOk(faq(), host.host);
    expect(result.events).toEqual([
      { type: 'message', nodeId: 'saludo', content: [{ kind: 'text', text: expect.any(String) }], typingDelayMs: 400 },
      { type: 'error', nodeId: 'asistente', code: 'unsupported_node', message: expect.any(String) },
    ]);
    expect(host.requests).toHaveLength(0);
  });
});
