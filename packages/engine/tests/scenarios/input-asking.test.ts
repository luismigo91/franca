import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_RENDERED_LENGTH } from '../../src/index.js';
import { reply, replyOk, simpleFlow, waiting } from '../helpers/conversation.js';
import { choicesOf, end, flowOf, input, message, messageTexts, setNode, startOk, variable } from '../helpers/flows.js';

const leads = (): any => JSON.parse(readFileSync(new URL('../../../spec/examples/captacion-leads.json', import.meta.url), 'utf8'));
const inputEvent = (result: { events: any[] }) => result.events.find((e) => e.type === 'input');

describe('Nodo input: pregunta y espera', () => {
  it('Ejemplo de captación de leads', async () => {
    const result = await startOk(leads());
    expect(result.events.map((e) => [e.type, e.nodeId])).toEqual([
      ['message', 'bienvenida'],
      ['message', 'pedir-nombre'],
      ['input', 'pedir-nombre'],
    ]);
    expect(messageTexts(result.events)[1]).toBe('¿Cómo te llamas?');
    expect(inputEvent(result)).toMatchObject({ inputType: 'text' });
    expect(result.status).toBe('waiting');
    expect(result.state).toMatchObject({ status: 'waiting', nodeId: 'pedir-nombre', outcome: null, error: null });
  });

  it('Prompt con plantillas', async () => {
    const flow = flowOf(
      [
        setNode('s', [['nombre', 'Ana']], 'p'),
        input('p', 'email', 'email', 'fin', { prompt: [{ kind: 'text', text: 'Encantado, {{nombre}}. ¿Tu email?' }] }),
        end('fin'),
      ],
      { variables: [variable('nombre'), variable('email')], settings: { typingDelayMs: 250 } },
    );
    const result = await startOk(flow);
    expect(result.events[0]).toEqual({
      type: 'message',
      nodeId: 'p',
      content: [{ kind: 'text', text: 'Encantado, Ana. ¿Tu email?' }],
      typingDelayMs: 250,
    });
  });

  it('Preguntar no toca la variable', async () => {
    const flow = simpleFlow('email', {}, { variableExtra: { scope: 'contact' } });
    const result = await startOk(flow, { v: 'previo@example.com' });
    expect(result.status).toBe('waiting');
    expect(result.state.contact).toEqual({ v: 'previo@example.com' });
  });
});

describe('Evento input', () => {
  it('Input de texto mínimo', async () => {
    const result = await startOk(simpleFlow('text'));
    const event = inputEvent(result);
    expect(event).toEqual({ type: 'input', nodeId: 'p', inputType: 'text', attempt: 1, reason: null });
    expect(Object.keys(event)).toEqual(['type', 'nodeId', 'inputType', 'attempt', 'reason']);
    for (const key of ['placeholder', 'choices', 'multiple']) expect(event).not.toHaveProperty(key);
  });

  it('Placeholder con plantilla', async () => {
    const flow = flowOf(
      [setNode('s', [['nombre', 'ana']], 'p'), input('p', 'email', 'email', 'fin', { placeholder: '{{nombre}}@empresa.com' }), end('fin')],
      { variables: [variable('nombre'), variable('email')] },
    );
    expect(inputEvent(await startOk(flow))).toMatchObject({ placeholder: 'ana@empresa.com' });
  });

  it('La validación no se expone', async () => {
    const validation = { pattern: '^\\d{5}$', min: 5, max: 5, retryMessage: 'Revisa el código' };
    const event = inputEvent(await startOk(simpleFlow('text', { validation })));
    const text = JSON.stringify(event);
    for (const secret of ['^\\\\d{5}$', 'Revisa el código', '"min"', '"max"', '"v"']) expect(text).not.toContain(secret);
    expect(Object.keys(event)).toEqual(['type', 'nodeId', 'inputType', 'attempt', 'reason']);
  });
});

describe('Opciones en el evento input', () => {
  it('Opciones del ejemplo', async () => {
    const flow = leads();
    const { state } = await waiting(flow);
    const afterName = await replyOk(flow, state, { text: 'Ana' });
    const afterEmail = await replyOk(flow, afterName.state, { text: 'ana@example.com' });
    const event = inputEvent(afterEmail);
    expect(event).toEqual({
      type: 'input',
      nodeId: 'pedir-tamano',
      inputType: 'choice',
      attempt: 1,
      reason: null,
      multiple: false,
      choices: [
        { id: 'pequena', label: '1 a 10' },
        { id: 'mediana', label: '11 a 50' },
        { id: 'grande', label: 'Más de 50' },
      ],
    });
    expect(JSON.stringify(event)).not.toContain('value');
  });

  it('Label e imagen con plantillas', async () => {
    const flow = flowOf(
      [
        setNode('s', [['nombre', 'Ana']], 'p'),
        input('p', 'v', 'choice', undefined, {
          choices: [
            { id: 'a', label: 'Para {{nombre}}', imageUrl: 'https://example.com/{{nombre}}.png', next: 'fin' },
            { id: 'b', label: 'Otra', next: 'fin' },
          ],
        }),
        end('fin'),
      ],
      { variables: [variable('nombre'), variable('v')] },
    );
    const event = inputEvent(await startOk(flow));
    expect(event.choices).toEqual([
      { id: 'a', label: 'Para Ana', imageUrl: 'https://example.com/Ana.png' },
      { id: 'b', label: 'Otra' },
    ]);
    expect(event.choices[1]).not.toHaveProperty('imageUrl');
  });

  it('Selección múltiple', async () => {
    const flow = flowOf([input('p', 'v', 'choice', 'fin', { multiple: true, choices: choicesOf(['a', 'b']) }), end('fin')], {
      variables: [variable('v')],
    });
    expect(inputEvent(await startOk(flow))).toMatchObject({ multiple: true });
  });

  it('multiple fuera de choice', async () => {
    const event = inputEvent(await startOk(simpleFlow('text', { multiple: true })));
    expect(event).not.toHaveProperty('multiple');
    expect(event).not.toHaveProperty('choices');
  });
});

describe('Tamaño máximo de los textos de un input', () => {
  const big = variable('a', { default: 'x'.repeat(MAX_RENDERED_LENGTH) });

  it('Label demasiado largo', async () => {
    const flow = flowOf(
      [
        message('antes', 'Hola', 'p'),
        input('p', 'v', 'choice', undefined, { choices: [{ id: 'a', label: '{{a}}!', next: 'fin' }] }),
        end('fin'),
      ],
      { variables: [big, variable('v')] },
    );
    const result = await startOk(flow);
    expect(result.events.map((e) => [e.type, e.nodeId])).toEqual([
      ['message', 'antes'],
      ['error', 'p'],
    ]);
    expect(result.events[1]).toMatchObject({ code: 'value_too_large' });
  });

  it('Retry message demasiado largo', async () => {
    const flow = flowOf([input('p', 'v', 'email', 'fin', { validation: { retryMessage: '{{a}}!' } }), end('fin')], {
      variables: [big, variable('v')],
    });
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: 'no' });
    expect(result.status).toBe('failed');
    expect(result.events).toEqual([{ type: 'error', nodeId: 'p', code: 'value_too_large', message: expect.any(String) }]);
    expect(result.state.error).toEqual({ code: 'value_too_large', nodeId: 'p' });
  });

  it('prompt, placeholder e imageUrl también están acotados', async () => {
    const cases: Record<string, unknown>[] = [
      { prompt: [{ kind: 'text', text: '{{a}}!' }] },
      { placeholder: '{{a}}!' },
      { choices: [{ id: 'a', label: 'ok', imageUrl: '{{a}}!', next: 'fin' }] },
    ];
    for (const extra of cases) {
      const type = 'choices' in extra ? 'choice' : 'text';
      const flow = flowOf([input('p', 'v', type, type === 'choice' ? undefined : 'fin', extra), end('fin')], { variables: [big, variable('v')] });
      const result = await startOk(flow);
      expect(result.events).toEqual([{ type: 'error', nodeId: 'p', code: 'value_too_large', message: expect.any(String) }]);
    }
  });
});

describe('Validación que no se puede aplicar', () => {
  const failing = async (inputType: string, extra: Record<string, unknown>) => {
    const flow = flowOf(
      [message('antes', 'Hola', 'p'), input('p', 'v', inputType, 'fin', extra), end('fin')],
      { variables: [variable('v')] },
    );
    return startOk(flow);
  };

  it('Patrón inválido al preguntar', async () => {
    const result = await failing('text', { validation: { pattern: '(' } });
    expect(result.events.map((e) => [e.type, e.nodeId])).toEqual([
      ['message', 'antes'],
      ['error', 'p'],
    ]);
    expect(result.events[1]).toMatchObject({ code: 'invalid_validation' });
    expect(result.state.error).toEqual({ code: 'invalid_validation', nodeId: 'p' });
  });

  it('Construcción no admitida o rango imposible', async () => {
    for (const [type, extra] of [
      ['text', { validation: { pattern: '(a)\\1' } }],
      ['number', { validation: { min: 5, max: 2 } }],
    ] as const) {
      const result = await failing(type, extra);
      expect(result.status).toBe('failed');
      expect(result.state.error?.code).toBe('invalid_validation');
    }
  });

  it('Límites que ninguna respuesta puede cumplir', async () => {
    const multiple = (validation: object, ids: string[]) => ({ multiple: true, choices: choicesOf(ids), validation });
    const cases: [string, Record<string, unknown>][] = [
      ['text', { validation: { max: 0 } }],
      ['text', { validation: { min: 5000 } }],
      ['choice', multiple({ max: 0 }, ['a', 'b'])],
      ['choice', multiple({ min: 4 }, ['a', 'b', 'c'])],
    ];
    for (const [type, extra] of cases) {
      const result = await failing(type, extra);
      expect(result.events.map((e) => e.type)).toEqual(['message', 'error']);
      expect(result.events[1]).toMatchObject({ code: 'invalid_validation', nodeId: 'p' });
    }
  });

  it('Configuración ignorada no falla', async () => {
    const ignoredEmail = await failing('email', { validation: { min: 5, max: 2 } });
    const ignoredChoice = await failing('choice', { choices: choicesOf(['a', 'b'], 'fin'), next: undefined, validation: { pattern: '(' } });
    expect(ignoredEmail.status).toBe('waiting');
    expect(ignoredChoice.status).toBe('waiting');
  });

  it('Flujo cambiado mientras se espera', async () => {
    const original = simpleFlow('text');
    const { state } = await waiting(original);
    const changed = simpleFlow('text', { validation: { pattern: '(' } });
    const failed = await replyOk(changed, state, { text: 'Ana' });
    expect(failed.status).toBe('failed');
    expect(failed.state.error).toEqual({ code: 'invalid_validation', nodeId: 'p' });
    expect(await reply(changed, state, { text: 5 })).toMatchObject({ ok: false, code: 'invalid_input' });
  });
});

describe('Momento de la comprobación de la validación', () => {
  it('La validación gana al tamaño', async () => {
    const flow = flowOf(
      [input('p', 'v', 'text', 'fin', { validation: { pattern: '(' }, prompt: [{ kind: 'text', text: '{{a}}!' }] }), end('fin')],
      { variables: [variable('a', { default: 'x'.repeat(MAX_RENDERED_LENGTH) }), variable('v')] },
    );
    const result = await startOk(flow);
    expect(result.state.error?.code).toBe('invalid_validation');
  });
});
