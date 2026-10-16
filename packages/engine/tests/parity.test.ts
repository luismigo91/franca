import { schema } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { REJECTION_CODES, SESSION_ERROR_CODES, continueSession, startSession } from '../src/index.js';
import { EXECUTORS } from '../src/nodes/index.js';
import { OPERATORS } from '../src/predicates.js';
import { allFlows } from './helpers/files.js';
import { deepFreeze, end, flowOf, http, jump, message, variable } from './helpers/flows.js';

type Defs = Record<string, { properties?: { type?: { const?: string } } }>;
const defs = schema.$defs as unknown as Defs;

describe('paridad con flow.schema.json', () => {
  it('los tipos de nodo del esquema son las claves de EXECUTORS', () => {
    const refs = (schema.$defs.node.oneOf as { $ref: string }[]).map((entry) => entry.$ref.split('/').pop()!);
    const types = refs.map((ref) => defs[ref]!.properties!.type!.const!);
    expect(types.length).toBe(8);
    expect(Object.keys(EXECUTORS).sort()).toEqual([...types].sort());
  });

  it('los operadores del esquema son las claves de OPERATORS', () => {
    const ops = schema.$defs.rule.properties.op.enum;
    expect(Object.keys(OPERATORS).sort()).toEqual([...ops].sort());
  });
});

describe('códigos emitidos', () => {
  it('todo código de error de sesión emitido está en SESSION_ERROR_CODES', async () => {
    const emitted = new Set<string>();
    const flows: unknown[] = [
      flowOf([http('h', 'fin', 'fin'), end('fin')]),
      flowOf([message('m', '{{a}}{{a}}', 'fin'), end('fin')], { variables: [variable('a', { default: 'x'.repeat(10000) })] }),
      flowOf([{ id: 'c', type: 'condition', rules: [{ when: { variable: 'a', op: 'eq' }, next: 'fin' }], else: 'fin' }, end('fin')], {
        variables: [variable('a')],
      }),
      flowOf([jump('a', 'b'), jump('b', 'a'), end('fin')], {}),
    ];
    // el último flujo es un ciclo sin salida al end: se completa añadiendo una rama alcanzable
    flows[3] = flowOf(
      [
        { id: 'c', type: 'condition', rules: [{ when: { variable: 'a', op: 'eq', value: 'nunca' }, next: 'fin' }], else: 'j' },
        jump('j', 'c'),
        end('fin'),
      ],
      { variables: [variable('a')] },
    );
    for (const flow of flows) {
      const result = await startSession({ flow });
      if (result.ok) result.events.forEach((e) => e.type === 'error' && emitted.add(e.code));
    }
    expect([...emitted].sort()).toEqual([...SESSION_ERROR_CODES].sort());
  });

  it('todo código de rechazo emitido está en REJECTION_CODES', async () => {
    const good = flowOf([end('fin')]);
    const { state } = (await startSession({ flow: good })) as { state: unknown };
    const results = [
      await startSession({ flow: {} }),
      await startSession({ flow: good, contact: [] }),
      await continueSession({ flow: good, state: {}, input: null }),
      await continueSession({ flow: flowOf([end('fin')], { id: 'otro' }), state, input: null }),
      await continueSession({ flow: good, state, input: null }),
    ];
    const emitted = results.map((r) => (r.ok ? null : r.code));
    expect(new Set(emitted)).toEqual(new Set(REJECTION_CODES));
  });

  it('los códigos de error de los fixtures y ejemplos pertenecen a la lista', async () => {
    for (const { label, flow } of allFlows()) {
      const result = await startSession({ flow: deepFreeze(structuredClone(flow)) });
      if (!result.ok) {
        expect(REJECTION_CODES as readonly string[], label).toContain(result.code);
        continue;
      }
      for (const event of result.events) {
        if (event.type === 'error') expect(SESSION_ERROR_CODES as readonly string[], label).toContain(event.code);
      }
    }
  });
});
