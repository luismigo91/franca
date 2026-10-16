import { describe, expect, it } from 'vitest';
import { createLlmCapability, type LlmCapability, type LlmTurnRequest } from '../../src/index.js';

const request = (provider: string): LlmTurnRequest => ({
  nodeId: 'a',
  provider,
  model: null,
  system: null,
  goal: 'g',
  slots: [],
  history: [],
  temperature: null,
  locale: 'es',
  turn: 1,
  maxTurns: 8,
});

const TURN = { kind: 'turn', text: 'hola', slots: {}, done: false, costUsd: 0 } as const;

/** Un proveedor que registra con qué petición y con qué `this` se le llamó. */
function recorder(result: unknown = TURN): { llm: LlmCapability; calls: { request: LlmTurnRequest; receiver: unknown }[] } {
  const calls: { request: LlmTurnRequest; receiver: unknown }[] = [];
  const llm = function (this: unknown, req: LlmTurnRequest) {
    calls.push({ request: req, receiver: this });
    return Promise.resolve(result);
  } as unknown as LlmCapability;
  return { llm, calls };
}

describe('createLlmCapability', () => {
  it('entrega la petición al proveedor de nombre exacto y devuelve su resultado', async () => {
    const principal = recorder();
    const barato = recorder({ kind: 'failed', costUsd: 0 });
    const llm = createLlmCapability({ principal: principal.llm, barato: barato.llm });
    const req = request('barato');
    await expect(llm(req)).resolves.toEqual({ kind: 'failed', costUsd: 0 });
    expect(barato.calls).toHaveLength(1);
    expect(barato.calls[0]!.request).toBe(req);
    expect(principal.calls).toHaveLength(0);
  });

  it.each(['Principal', 'otro', '', 'principal '])('el nombre %j no coincide: not_configured sin llamar a nadie', async (name) => {
    const principal = recorder();
    await expect(createLlmCapability({ principal: principal.llm })(request(name))).resolves.toEqual({ kind: 'not_configured' });
    expect(principal.calls).toHaveLength(0);
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])('%s no es un proveedor heredado (objeto)', async (name) => {
    const principal = recorder();
    await expect(createLlmCapability({ principal: principal.llm })(request(name))).resolves.toEqual({ kind: 'not_configured' });
    expect(principal.calls).toHaveLength(0);
  });

  it('un objeto con una propiedad propia __proto__ (como la crea JSON.parse o Object.fromEntries) cuenta como proveedor', async () => {
    const q = recorder();
    const providers = Object.fromEntries([['__proto__', q.llm]]) as Record<string, LlmCapability>;
    expect(Object.hasOwn(providers, '__proto__')).toBe(true);
    await createLlmCapability(providers)(request('__proto__'));
    expect(q.calls).toHaveLength(1);
  });

  it('un Map con la clave "__proto__" se respeta', async () => {
    const q = recorder();
    await createLlmCapability(new Map([['__proto__', q.llm]]))(request('__proto__'));
    expect(q.calls).toHaveLength(1);
  });

  it('un Map no hereda: constructor da not_configured', async () => {
    const q = recorder();
    await expect(createLlmCapability(new Map([['principal', q.llm]]))(request('constructor'))).resolves.toEqual({ kind: 'not_configured' });
  });

  it.each([
    ['objeto con un string', () => createLlmCapability({ principal: 'x' } as never)],
    ['Map con null', () => createLlmCapability(new Map([['principal', null]]) as never)],
    ['objeto con un objeto', () => createLlmCapability({ principal: {} } as never)],
    ['null', () => createLlmCapability(null as never)],
    ['un string', () => createLlmCapability('x' as never)],
  ])('%s → TypeError al crearse', (_name, create) => {
    expect(create).toThrow(TypeError);
  });

  it('el mensaje del TypeError es fijo y no incluye el valor', () => {
    try {
      createLlmCapability({ principal: 'MARCA-SECRETA' } as never);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('MARCA-SECRETA');
      expect((error as Error).message).not.toContain('principal');
    }
  });

  it('copia los proveedores al crearse: mutar después el objeto o el Map no cambia el enrutado', async () => {
    const p = recorder();
    const q = recorder();
    const object: Record<string, LlmCapability> = { principal: p.llm };
    const map = new Map([['principal', p.llm]]);
    const fromObject = createLlmCapability(object);
    const fromMap = createLlmCapability(map);
    object.principal = q.llm;
    object.nuevo = q.llm;
    map.set('principal', q.llm);
    map.set('nuevo', q.llm);
    await fromObject(request('principal'));
    await fromMap(request('principal'));
    await expect(fromObject(request('nuevo'))).resolves.toEqual({ kind: 'not_configured' });
    await expect(fromMap(request('nuevo'))).resolves.toEqual({ kind: 'not_configured' });
    expect(p.calls).toHaveLength(2);
    expect(q.calls).toHaveLength(0);
  });

  it('no llama al proveedor con el objeto de proveedores como this', async () => {
    const p = recorder();
    const providers = { principal: p.llm };
    await createLlmCapability(providers)(request('principal'));
    expect(p.calls[0]!.receiver).toBeUndefined();
  });

  it('solo cuentan las propiedades propias y enumerables de un objeto', async () => {
    const p = recorder();
    const proto = { heredado: p.llm };
    const providers = Object.create(proto) as Record<string, LlmCapability>;
    providers.propio = p.llm;
    Object.defineProperty(providers, 'oculto', { value: p.llm, enumerable: false });
    const llm = createLlmCapability(providers);
    await expect(llm(request('heredado'))).resolves.toEqual({ kind: 'not_configured' });
    await expect(llm(request('oculto'))).resolves.toEqual({ kind: 'not_configured' });
    await llm(request('propio'));
    expect(p.calls).toHaveLength(1);
  });

  it('un proveedor que rechaza rechaza la capacidad (el motor lo trata como llm_host_error)', async () => {
    const llm = createLlmCapability({ principal: () => Promise.reject(new Error('x')) });
    await expect(llm(request('principal'))).rejects.toThrow('x');
  });
});

describe('createLlmCapability: el resultado compartido', () => {
  it('not_configured es el mismo objeto en cada petición y está congelado: un proveedor no puede mutarlo para las siguientes', async () => {
    const llm = createLlmCapability({});
    const first = await llm(request('otro'));
    const second = await llm(request('otro'));
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { kind: string }).kind = 'turn';
    }).toThrow(TypeError);
    expect(await llm(request('otro'))).toEqual({ kind: 'not_configured' });
  });
});

