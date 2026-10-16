import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { call } from '../src/conformance/call.js';
import { CALL_DEADLINE_MARGIN_MS, CONFORMANCE_INTERNAL_ADDRESSES, HOST_CONFORMANCE_CASES } from '../src/conformance/index.js';
import type { HostConformanceHarness } from '../src/conformance/types.js';
import type { HttpCapability, HttpRequest } from '../src/index.js';

const CHANGE_SPEC = new URL('../../../openspec/changes/engine-http/specs/flow-engine/spec.md', import.meta.url);
const MAIN_SPEC = new URL('../../../openspec/specs/flow-engine/spec.md', import.meta.url);
// Mientras el cambio no se archiva, el catálogo se liga al delta; después, a la spec vigente.
const specText = readFileSync(existsSync(CHANGE_SPEC) ? CHANGE_SPEC : MAIN_SPEC, 'utf8');

/** requisito → escenarios, en el orden de la spec. */
function parseSpec(text: string): Map<string, string[]> {
  const requirements = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of text.split('\n')) {
    const requirement = /^### Requirement: (.+)$/.exec(line);
    if (requirement) {
      current = [];
      requirements.set(requirement[1]!, current);
      continue;
    }
    const scenario = /^#### Scenario: (.+)$/.exec(line);
    if (scenario && current) current.push(scenario[1]!);
  }
  return requirements;
}

const spec = parseSpec(specText);

describe('catálogo ↔ spec', () => {
  it('hay 17 casos con id único en kebab-case', () => {
    expect(HOST_CONFORMANCE_CASES).toHaveLength(17);
    const ids = HOST_CONFORMANCE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it.each(HOST_CONFORMANCE_CASES.map((c) => [c.id, c] as const))('%s: su requisito y su escenario existen con ese título en la spec', (_id, c) => {
    expect(spec.has(c.requirement), `requisito «${c.requirement}»`).toBe(true);
    expect(spec.get(c.requirement), `escenario «${c.scenario}» de «${c.requirement}»`).toContain(c.scenario);
  });

  it('todo escenario de un requisito «Host de producción: …» tiene exactamente un caso', () => {
    const hostRequirements = [...spec.entries()].filter(([title]) => title.startsWith('Host de producción: '));
    expect(hostRequirements.length).toBeGreaterThanOrEqual(8);
    let scenarios = 0;
    for (const [requirement, titles] of hostRequirements) {
      for (const scenario of titles) {
        scenarios++;
        const cases = HOST_CONFORMANCE_CASES.filter((c) => c.requirement === requirement && c.scenario === scenario);
        expect(cases, `${requirement} / ${scenario}`).toHaveLength(1);
      }
    }
    expect(scenarios).toBe(HOST_CONFORMANCE_CASES.length);
  });
});

describe('CONFORMANCE_INTERNAL_ADDRESSES', () => {
  it('contiene todas las direcciones de «Dominios que resuelven a direcciones internas»', () => {
    const start = specText.indexOf('#### Scenario: Dominios que resuelven a direcciones internas');
    const given = specText.slice(start).split('\n').find((line) => line.startsWith('- **GIVEN**'))!;
    const fromSpec = [...given.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    expect(fromSpec).toHaveLength(25);
    for (const address of fromSpec) expect(CONFORMANCE_INTERNAL_ADDRESSES, address).toContain(address);
  });

  it('no repite direcciones', () => {
    expect(new Set(CONFORMANCE_INTERNAL_ADDRESSES).size).toBe(CONFORMANCE_INTERNAL_ADDRESSES.length);
    expect(CONFORMANCE_INTERNAL_ADDRESSES).toHaveLength(25);
  });

  it('incluye loopback IPv4 e IPv6, que el arnés no puede usar para sus servidores', () => {
    expect(CONFORMANCE_INTERNAL_ADDRESSES).toContain('127.0.0.1');
    expect(CONFORMANCE_INTERNAL_ADDRESSES).toContain('::1');
  });
});

describe('call', () => {
  /** Un arnés mínimo para call: reloj fijo y una espera que vence tras un macrotask (la llamada válida resuelve antes). */
  const harness = (clock = { value: 0 }): HostConformanceHarness =>
    ({
      now: () => clock.value,
      timeToleranceMs: 100,
      sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      http: () => async () => ({ kind: 'blocked' }),
    }) as unknown as HostConformanceHarness;
  const request: HttpRequest = { nodeId: 'n', method: 'GET', url: 'https://a.example.com/', headers: [], body: null, timeoutMs: 500, attempt: 1, containsPii: false };
  const withCapability = (capability: unknown) => call(harness(), request, 'prueba', capability as HttpCapability);

  it('una capacidad que rechaza anota un fallo y call no rechaza', async () => {
    const outcome = await withCapability(() => Promise.reject(new Error('secreto-del-host')));
    expect(outcome.result).toBeNull();
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]).toContain('se rechazó');
    expect(outcome.failures.join()).not.toContain('secreto-del-host');
  });

  it('una capacidad que lanza de forma síncrona también', async () => {
    const outcome = await withCapability(() => {
      throw new Error('x');
    });
    expect(outcome.failures).toHaveLength(1);
  });

  it('un resultado fuera de contrato anota un fallo', async () => {
    const outcome = await withCapability(async () => ({ kind: 'response', status: 99, body: '' }));
    expect(outcome.result).toBeNull();
    expect(outcome.failures[0]).toContain('fuera de contrato');
  });

  it('una capacidad que nunca resuelve anota el fallo de espera límite con los milisegundos', async () => {
    const outcome = await withCapability(() => new Promise(() => {}));
    expect(outcome.failures).toEqual([`prueba: el host no resolvió en ${500 + 100 + CALL_DEADLINE_MARGIN_MS} ms`]);
  });

  it('un resultado válido no anota nada y devuelve el resultado leído', async () => {
    const outcome = await withCapability(async () => ({ kind: 'network_error', extra: 1 }));
    expect(outcome.failures).toEqual([]);
    expect(outcome.result).toEqual({ kind: 'network_error', requestSent: true });
  });

  it('mide el tiempo con el reloj del arnés', async () => {
    const clock = { value: 1000 };
    const outcome = await call(harness(clock), request, 'prueba', async () => {
      clock.value = 1600;
      return { kind: 'timeout' };
    });
    expect(outcome.elapsedMs).toBe(600);
  });

  it('usa harness.http() si no se le da capacidad', async () => {
    const outcome = await call(harness(), request, 'prueba');
    expect(outcome.result).toEqual({ kind: 'blocked' });
  });

  it('CALL_DEADLINE_MARGIN_MS vale 1000', () => {
    expect(CALL_DEADLINE_MARGIN_MS).toBe(1000);
  });
});
