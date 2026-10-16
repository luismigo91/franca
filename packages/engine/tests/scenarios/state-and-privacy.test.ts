import { llmFlow } from '../helpers/flows.js';
import { always as alwaysHttp, respond as respondHttp } from '../helpers/http-host.js';
import { alwaysLlm, turn, withHosts } from '../helpers/llm-host.js';
import { begin } from '../helpers/llm-run.js';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { continueSession, startSession } from '../../src/index.js';
import { reply, replyOk, simpleFlow, waiting } from '../helpers/conversation.js';
import {
  condition,
  deepFreeze,
  end,
  flowOf,
  http,
  message,
  rule,
  setNode,
  start,
  startOk,
  variable,
} from '../helpers/flows.js';

const example = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../spec/examples/${name}.json`, import.meta.url), 'utf8'));

const rich = () =>
  flowOf(
    [
      message('m', 'Hola {{nombre}}', 's'),
      setNode('s', [['nombre', 'Ana'], ['n', 3]], 'c'),
      condition('c', [[rule('n', 'gt', 2), 'fin']], 'fin'),
      end('fin', { outcome: 'ok', text: '{{nombre}} {{email}}' }),
    ],
    {
      variables: [
        variable('nombre', { pii: true }),
        variable('n', { type: 'number' }),
        variable('email', { type: 'email', scope: 'contact', pii: true }),
        variable('datos', { type: 'json', default: { a: [1, { b: null }] } }),
      ],
    },
  );

describe('Estado de sesión serializable', () => {
  it('Ida y vuelta por JSON', async () => {
    for (const flow of [rich(), example('captacion-leads'), example('faq-ia')]) {
      const { state } = await startOk(flow, { email: 'ana@example.com' });
      const roundTrip = JSON.parse(JSON.stringify(state));
      expect(roundTrip).toEqual(state);
      if (state.status === 'waiting') {
        // y se puede usar para continuar: da lo mismo que con el objeto original
        const withObject = await continueSession({ flow, state, input: { text: 'Ana' } });
        const withJson = await continueSession({ flow, state: roundTrip, input: { text: 'Ana' } });
        expect(withJson).toEqual(withObject);
      }
    }
  });

  it('Estado tras un fallo', async () => {
    const flow = example('captacion-leads');
    const { state } = await waiting(flow);
    const name = await replyOk(flow, state, { text: 'Ana' });
    const mail = await replyOk(flow, name.state, { text: 'ana@example.com' });
    const result = await replyOk(flow, mail.state, { choice: 'grande' });
    expect(result.state).toMatchObject({
      stateVersion: 1,
      flowId: 'captacion-leads',
      status: 'failed',
      nodeId: 'enviar-crm',
      outcome: null,
      error: { code: 'unsupported_node', nodeId: 'enviar-crm' },
    });
    expect(result.state).not.toHaveProperty('attempt');
  });

  it('Estado en espera', async () => {
    const { state } = await waiting(example('captacion-leads'));
    expect(state).toMatchObject({ status: 'waiting', nodeId: 'pedir-nombre', outcome: null, error: null, attempt: 1 });
  });

  it('el estado no comparte referencias con el flujo', async () => {
    const flow = rich();
    const { state } = await startOk(flow);
    expect(state.variables.datos).toEqual({ a: [1, { b: null }] });
    const defaultValue = (flow.variables as { default?: unknown }[])[3]!.default;
    expect(state.variables.datos).not.toBe(defaultValue);
  });

  it('el estado de un fin lleva la versión de su formato', async () => {
    const { state } = await startOk(rich());
    expect(state).toMatchObject({ stateVersion: 1, status: 'ended', error: null });
  });
});

describe('Ejecución determinista y sin efectos externos', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Dos ejecuciones iguales', async () => {
    const contact = { email: 'ana@example.com' };
    const a = await startOk(rich(), contact);
    const b = await startOk(rich(), contact);
    expect(a).toEqual(b);
  });

  it('Sin escritura en consola', async () => {
    const spies = (Object.keys(console) as (keyof Console)[])
      .filter((key) => typeof console[key] === 'function')
      .map((key) => vi.spyOn(console, key as 'log').mockImplementation(() => {}));
    expect(spies.length).toBeGreaterThan(5);
    // termina, falla y se rechaza
    await startOk(rich());
    await startOk(flowOf([http('h', 'fin', 'fin'), end('fin')]));
    await startOk(flowOf([condition('c', [[rule('v', 'matches', '('), 'fin']], 'fin'), end('fin')], { variables: [variable('v', { default: 'x' })] }));
    const asking = simpleFlow('email');
    const waitingState = (await waiting(asking)).state;
    await reply(asking, waitingState, { text: 'no' }); // reintenta
    await reply(asking, waitingState, { text: 5 }); // rechaza
    await reply(asking, waitingState, { text: 'ana@example.com' }); // termina
    await start({});
    await startSession({ flow: rich(), contact: { email: NaN } });
    await continueSession({ flow: rich(), state: {}, input: 'hola' });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('Entradas congeladas', async () => {
    const flow = deepFreeze(rich());
    const contact = deepFreeze({ email: 'ana@example.com', otro: { lista: [1, 2] } });
    const flowBefore = structuredClone(flow);
    const contactBefore = structuredClone(contact);
    const result = await startOk(flow, contact);
    expect(result.status).toBe('ended');
    expect(flow).toEqual(flowBefore);
    expect(contact).toEqual(contactBefore);
  });

  it('el estado recibido por continueSession no cambia', async () => {
    const flow = rich();
    const { state } = await startOk(flow);
    const frozen = deepFreeze(structuredClone(state));
    const result = await continueSession({ flow, state: frozen, input: 'x' });
    expect(result).toMatchObject({ ok: false, code: 'session_not_active' });
    expect(frozen).toEqual(state);
  });
});

describe('Continuación determinista y sin efectos', () => {
  it('Dos continuaciones iguales', async () => {
    const flow = example('captacion-leads');
    const { state } = await waiting(flow);
    const a = await continueSession({ flow, state, input: { text: ' Ana ' } });
    const b = await continueSession({ flow, state, input: { text: ' Ana ' } });
    expect(a).toEqual(b);
  });

  it('Continuación con entradas congeladas', async () => {
    const flow = deepFreeze(structuredClone(example('captacion-leads')));
    const { state } = await waiting(flow);
    const frozenState = deepFreeze(structuredClone(state));
    const frozenInput = deepFreeze({ text: 'Ana' });
    const before = [structuredClone(flow), structuredClone(frozenState), structuredClone(frozenInput)];
    const result = await continueSession({ flow, state: frozenState, input: frozenInput });
    expect(result.ok).toBe(true);
    expect([flow, frozenState, frozenInput]).toEqual(before);
  });
});

describe('Los errores no revelan valores de variables', () => {
  it('Regla inválida sobre una variable pii', async () => {
    const flow = flowOf(
      [condition('c', [[rule('email', 'matches', '('), 'fin']], 'fin'), end('fin')],
      { variables: [variable('email', { type: 'email', scope: 'contact', pii: true })] },
    );
    const result = await startOk(flow, { email: 'ana@example.com' });
    expect(result.state.error?.code).toBe('invalid_rule');
    expect(JSON.stringify(result.events)).not.toContain('ana@example.com');
    expect(JSON.stringify(result.state.error)).not.toContain('ana@example.com');
  });

  it('Reintentos agotados con una respuesta pii', async () => {
    const flow = simpleFlow('email', { validation: { maxRetries: 0 } }, { variableExtra: { pii: true, scope: 'contact' } });
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: 'ana@ejemplo' });
    expect(result.events).toEqual([{ type: 'error', nodeId: 'p', code: 'retries_exhausted', message: expect.any(String) }]);
    expect(JSON.stringify(result.events)).not.toContain('ana@ejemplo');
    expect(JSON.stringify(result.state.error)).not.toContain('ana@ejemplo');
  });

  it('Rechazo de contacto inválido', async () => {
    const flow = flowOf([end('fin')], {
      variables: [variable('email', { scope: 'contact' }), variable('edad', { type: 'number', scope: 'contact' })],
    });
    const result = await start(flow, { email: 'ana@example.com', edad: NaN });
    expect(result).toMatchObject({ ok: false, code: 'invalid_contact' });
    const text = JSON.stringify(result);
    expect(text).not.toContain('ana@example.com');
    expect(text).toContain('edad');
  });

  it('una clave ajena no se nombra en el rechazo', async () => {
    const flow = flowOf([end('fin')]);
    const result = await start(flow, { 'clave-del-host-con-secreto': NaN });
    expect(result).toMatchObject({ ok: false, code: 'invalid_contact' });
    expect(JSON.stringify(result)).not.toContain('secreto');
  });

  it('un valor de variable renderizado no aparece en ningún error', async () => {
    const flow = flowOf(
      [setNode('s', [['dato', 'SECRETO-123']], 'h'), http('h', 'fin', 'fin'), end('fin')],
      { variables: [variable('dato', { pii: true })] },
    );
    const result = await startOk(flow);
    expect(JSON.stringify(result.events)).not.toContain('SECRETO-123');
    expect(JSON.stringify(result.state.error)).not.toContain('SECRETO-123');
  });
});

describe('Estado de sesión serializable con llm', () => {
  it('Estado en espera en un llm', async () => {
    const llm = alwaysLlm(turn('¿En qué puedo ayudarte?'));
    const { host } = withHosts(alwaysHttp(respondHttp(200)).host, llm.host);
    const result = await begin(example('faq-ia'), host);
    expect(result.state).toMatchObject({ status: 'waiting', nodeId: 'asistente', outcome: null, error: null });
  });

  it('Continuación en un llm con entradas congeladas', async () => {
    const flow = deepFreeze(llmFlow());
    const first = await begin(flow, alwaysLlm(turn('¿Me das tu email?')).host);
    const state = deepFreeze(structuredClone(first.state));
    const input = deepFreeze({ text: 'Hola' });
    const slots = deepFreeze({ email: 'ana@example.com' });
    const before = [structuredClone(flow), structuredClone(state), structuredClone(input), structuredClone(slots)];
    const result = await continueSession({ flow, state, input }, alwaysLlm(turn('Gracias', slots, true)).host);
    expect(result.ok).toBe(true);
    expect([flow, state, input, slots]).toEqual(before);
  });
});
