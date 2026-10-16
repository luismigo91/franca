import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { createLlmCapability, startSession, type EngineHost, type LlmCapability } from '../../src/index.js';
import { readExample } from '../helpers/files.js';
import { end, llmFlow, llmNode, setNode, variable } from '../helpers/flows.js';
import { always, respond } from '../helpers/http-host.js';
import {
  alwaysLlm,
  ClassLlmHost,
  expectLlmScript,
  failed,
  getterLlm,
  notConfigured,
  rejectingLlm,
  scriptedLlm,
  throwingLlm,
  turn,
} from '../helpers/llm-host.js';
import { assistantMessage, begin, expectEnded, expectFailed, proceed, waitingInput } from '../helpers/llm-run.js';

/** Un flujo `set` → `llm` → `end` (spec «Capacidad llm que no es una función»). */
const setThenLlm = () =>
  llmFlow({}, { nodes: [setNode('s', [['nombre', 'Ana']], 'a'), llmNode(), end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })] });

describe('Capacidad llm del host', () => {
  it('Una llamada por turno', async () => {
    const host = alwaysLlm(turn('¿Me das tu email?'));
    const result = await begin(llmFlow(), host.host);
    expectLlmScript(host, 1);
    expect(host.requests[0]).toMatchObject({ turn: 1, history: [] });
    expect(result.status).toBe('waiting');
  });

  it('Un flujo sin llm no llama al host', async () => {
    const host = alwaysLlm(turn('x'));
    const flow = { specVersion: '0.1', id: 'f', name: 'F', start: 'm', nodes: [{ id: 'm', type: 'message', content: [{ kind: 'text', text: 'hola' }], next: 'fin' }, end('fin')] };
    await begin(flow, host.host);
    expectLlmScript(host, 0);
  });

  it('Capacidad llm que no es una función', async () => {
    const result = await begin(setThenLlm(), { llm: 'no' } as unknown as EngineHost);
    expectFailed(result, 'unsupported_node', 'a');
    expect(result.state.contact).toEqual({ email: null });
    expect(result.state.variables).toEqual({ nombre: 'Ana' });
  });

  it('Un turno fallido no se repite', async () => {
    const host = alwaysLlm(failed(0));
    const result = await begin(llmFlow(), host.host);
    expectLlmScript(host, 1);
    expectEnded(result, 'ko');
  });

  it('Turnos en secuencia', async () => {
    const flow = llmFlow(
      {},
      { nodes: [llmNode({ slots: undefined, next: 'c' }), llmNode({ slots: undefined, next: 'ok' }, 'c'), end('ok', { outcome: 'ok' }), end('ko', { outcome: 'ko' })] },
    );
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return turn('listo', {}, true);
    };
    const host = alwaysLlm(slow);
    const result = await begin(flow, host.host);
    expect(host.requests.map((r) => r.nodeId)).toEqual(['a', 'c']);
    expect(host.maxInFlight).toBe(1);
    expectEnded(result, 'ok');
  });
});

describe('Lectura de la capacidad llm', () => {
  it('Host omitido o nulo con un llm', async () => {
    for (const host of [undefined, null]) {
      const result = await begin(setThenLlm(), host);
      expectFailed(result, 'unsupported_node', 'a');
    }
  });

  it('Host llm con métodos', async () => {
    const host = new ClassLlmHost();
    const result = await begin(llmFlow(), host);
    expect(result.status).toBe('waiting');
    expect(host.calls).toBe(1);
    expect(host.receivers).toEqual([host]);
    expect(host.receivers[0]).toBe(host);
  });

  it('el motor lee llm una sola vez por llegada', async () => {
    const script = scriptedLlm([turn('hola')]);
    const reads = getterLlm({ capability: script.llm });
    await begin(llmFlow(), reads.host);
    expect(reads.reads()).toBe(1);
  });
});

describe('Proveedores por nombre', () => {
  const recorder = (result: unknown = turn('hola')) => scriptedLlm([result], { repeatLast: true });

  it('Elección del proveedor', async () => {
    const p = recorder();
    const b = recorder();
    const host = { llm: createLlmCapability({ principal: p.llm, barato: b.llm }) };
    await begin(llmFlow({ provider: 'barato' }), host);
    expect(b.requests).toHaveLength(1);
    expect(b.requests[0]).toMatchObject({ provider: 'barato', turn: 1 });
    expect(p.requests).toHaveLength(0);
  });

  it('Nombre de proveedor desconocido', async () => {
    const p = recorder();
    const host = { llm: createLlmCapability({ principal: p.llm }) };
    for (const provider of ['Principal', 'otro']) {
      expectFailed(await begin(llmFlow({ provider }), host), 'llm_not_configured', 'a');
    }
    expect(p.requests).toHaveLength(0);
  });

  it('Nombres de proveedor que coinciden con propiedades de Object', async () => {
    const p = recorder();
    const host = { llm: createLlmCapability({ principal: p.llm }) };
    for (const provider of ['constructor', 'toString', '__proto__']) {
      expectFailed(await begin(llmFlow({ provider }), host), 'llm_not_configured', 'a');
    }
    expect(p.requests).toHaveLength(0);
    const q = recorder();
    await begin(llmFlow({ provider: '__proto__' }), { llm: createLlmCapability(new Map([['__proto__', q.llm]])) });
    expect(q.requests).toHaveLength(1);
  });
});

describe('Proveedores de la capacidad', () => {
  it('Proveedor que no es una función', () => {
    expect(() => createLlmCapability({ principal: 'x' } as unknown as Record<string, LlmCapability>)).toThrow(TypeError);
    expect(() => createLlmCapability(new Map([['principal', null]]) as unknown as Map<string, LlmCapability>)).toThrow(TypeError);
  });

  it('Proveedores copiados al crear', async () => {
    const p = scriptedLlm([turn('hola')]);
    const q = scriptedLlm([turn('hola')]);
    const providers: Record<string, LlmCapability> = { principal: p.llm };
    const host = { llm: createLlmCapability(providers) };
    providers.principal = q.llm;
    await begin(llmFlow(), host);
    expect(p.requests).toHaveLength(1);
    expect(q.requests).toHaveLength(0);
  });
});

describe('Nodo llm: primer turno', () => {
  it('Flujo de referencia llm-email', () => {
    const flow = llmFlow();
    expect(validateFlow(flow).valid).toBe(true);
    expect(flow).toMatchObject({
      start: 'a',
      variables: [
        { name: 'email', type: 'email', scope: 'contact', pii: true },
        { name: 'nombre', type: 'string' },
      ],
    });
    const node = (flow as { nodes: Record<string, unknown>[] }).nodes[0]!;
    expect(node).toMatchObject({ id: 'a', type: 'llm', provider: 'principal', goal: 'Consigue el email del usuario.', slots: [{ variable: 'email', description: 'Email de contacto' }], maxTurns: 3, next: 'ok', onExhausted: 'ko' });
  });

  it('Primer turno del ejemplo de FAQ', async () => {
    const host = scriptedLlm([turn('¿En qué puedo ayudarte?')]);
    const http = always(respond(200));
    const result = await begin(readExample('faq-ia'), { ...http.host, ...host.host });
    expect(result.events).toEqual([
      assistantMessage('Hola, soy el asistente. Pregúntame lo que necesites sobre el servicio.', 'saludo', 400),
      assistantMessage('¿En qué puedo ayudarte?', 'asistente', 400),
      waitingInput('asistente'),
    ]);
    expect(result.status).toBe('waiting');
    expect(result.state.nodeId).toBe('asistente');
  });
});

describe('Resultado de un turno', () => {
  it('Propiedades adicionales en un turno', async () => {
    const host = alwaysLlm({ ...turn('Hola'), usage: { inputTokens: 10, outputTokens: 5 }, model: 'x' });
    const result = await begin(llmFlow(), host.host);
    expect(result.status).toBe('waiting');
    const serialized = JSON.stringify([result.events, result.state]);
    expect(serialized).not.toContain('usage');
    expect(serialized).not.toContain('inputTokens');
  });
});

describe('Resultado del host llm fuera de contrato', () => {
  it('El host llm rechaza con un mensaje sensible', async () => {
    const flow = llmFlow();
    const host = rejectingLlm(new Error('fallo con ana@example.com'));
    const result = await begin(flow, host.host, { email: 'ana@example.com' });
    expectFailed(result, 'llm_host_error', 'a');
    expect(host.calls()).toBe(1);
    expect(JSON.stringify(result.events)).not.toContain('ana@example.com');
    expect(JSON.stringify(result.state.error)).not.toContain('ana@example.com');
  });

  it('Resultados de turno mal formados', async () => {
    const withGetter = () => {
      const result = { kind: 'turn' };
      Object.defineProperty(result, 'kind', { get: () => { throw new Error('getter'); } });
      return result;
    };
    const base = turn('x');
    const bad: unknown[] = [
      null,
      { kind: 'otro' },
      { ...base, costUsd: -0.01 },
      { ...base, costUsd: Number.NaN },
      { ...base, costUsd: Infinity },
      { ...base, costUsd: '0.01' },
      { kind: 'turn', text: 'x', slots: {}, done: false },
      { ...base, text: 5 },
      { ...base, slots: [] },
      { ...base, slots: null },
      { ...base, done: 'true' },
      { kind: 'failed' },
      withGetter(),
    ];
    for (const raw of bad) {
      const result = await begin(llmFlow(), alwaysLlm(raw).host);
      expectFailed(result, 'llm_host_error', 'a');
      expect(result.events.some((e) => e.type === 'llm')).toBe(false);
    }
    expectFailed(await begin(llmFlow(), throwingLlm().host), 'llm_host_error', 'a');
  });

  it('Coste que desborda el acumulado', async () => {
    const flow = llmFlow();
    const host = alwaysLlm(turn('sigue', {}, false, 1e308));
    const first = await begin(flow, host.host);
    expect(first.state.conversation?.costUsd).toBe(1e308);
    const second = await proceed(flow, JSON.parse(JSON.stringify(first.state)), 'Hola', host.host);
    expectFailed(second, 'llm_host_error', 'a');
    expect(second.events.some((e) => e.type === 'llm')).toBe(false);
  });

  it('Capacidad llm que lanza al leerla', async () => {
    const result = await begin(llmFlow(), getterLlm({ throws: true }).host);
    expectFailed(result, 'llm_host_error', 'a');
  });
});

describe('Proveedor no configurado', () => {
  it('Proveedor que falta en el ejemplo', async () => {
    const result = await begin(readExample('faq-ia'), { ...always(respond(200)).host, ...alwaysLlm(notConfigured).host });
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([
      assistantMessage('Hola, soy el asistente. Pregúntame lo que necesites sobre el servicio.', 'saludo', 400),
      { type: 'error', nodeId: 'asistente', code: 'llm_not_configured', message: 'el proveedor o el modelo del nodo no están configurados en la instalación' },
    ]);
  });

  it('Sin evento llm cuando la sesión falla', async () => {
    const result = await begin(llmFlow(), alwaysLlm(notConfigured).host);
    expect(result.events.some((e) => e.type === 'llm')).toBe(false);
    expect(result.events[result.events.length - 1]).toMatchObject({ type: 'error' });
  });
});
