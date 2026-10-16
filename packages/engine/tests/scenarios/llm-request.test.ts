import { describe, expect, it } from 'vitest';
import type { LlmTurnRequest } from '../../src/index.js';
import { readExample } from '../helpers/files.js';
import { llmFlow, variable } from '../helpers/flows.js';
import { always, respond } from '../helpers/http-host.js';
import { alwaysLlm, scriptedLlm, turn } from '../helpers/llm-host.js';
import { begin, chat, proceed } from '../helpers/llm-run.js';

describe('Petición de turno entregada al host', () => {
  it('Petición del primer turno del ejemplo de FAQ', async () => {
    const llm = alwaysLlm(turn('¿En qué puedo ayudarte?'));
    await begin(readExample('faq-ia'), { ...always(respond(200)).host, ...llm.host });
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]).toEqual({
      nodeId: 'asistente',
      provider: 'principal',
      model: null,
      system: 'Respondes solo sobre precios, horarios y envíos del servicio. Si no sabes algo, dilo y no inventes.',
      goal: 'Resolver la duda del usuario. Cuando quede resuelta o pida hablar con una persona, termina.',
      slots: [
        { name: 'resuelto', type: 'boolean', description: 'true si el usuario confirma que su duda está resuelta', required: true, collected: false },
        { name: 'motivo', type: 'string', description: 'Resumen en una frase de lo que necesita', required: false, collected: false },
      ],
      history: [],
      temperature: 0.2,
      locale: 'es',
      turn: 1,
      maxTurns: 10,
    });
  });

  it('las claves de la petición salen en el orden del contrato', async () => {
    const llm = alwaysLlm(turn('Hola'));
    await begin(llmFlow(), llm.host);
    expect(Object.keys(llm.requests[0]!)).toEqual(['nodeId', 'provider', 'model', 'system', 'goal', 'slots', 'history', 'temperature', 'locale', 'turn', 'maxTurns']);
  });

  it('Valores por defecto de la petición', async () => {
    const llm = alwaysLlm(turn('Hola'));
    await begin(llmFlow(), llm.host);
    expect(llm.requests[0]).toMatchObject({ model: null, system: null, temperature: null, locale: 'es', maxTurns: 3 });
    const other = alwaysLlm(turn('Hola'));
    await begin(llmFlow({ maxTurns: undefined }), other.host);
    expect(other.requests[0]!.maxTurns).toBe(8);
  });

  it('los valores del nodo y del flujo llegan a la petición', async () => {
    const llm = alwaysLlm(turn('Hola'));
    await begin(llmFlow({ model: 'claude-x', system: 'Eres amable.', temperature: 0, maxTurns: 5 }, { extra: { locale: 'en-GB' } }), llm.host);
    expect(llm.requests[0]).toMatchObject({ model: 'claude-x', system: 'Eres amable.', temperature: 0, locale: 'en-GB', maxTurns: 5 });
  });

  it('Plantillas en system y goal', async () => {
    const llm = alwaysLlm(turn('Hola'));
    const flow = llmFlow(
      { system: 'Hablas con {{nombre}}.', goal: 'Pide a {{nombre}} su email.' },
      { variables: [variable('email', { type: 'email', scope: 'contact', pii: true }), variable('nombre', { default: 'Ana' })] },
    );
    await begin(flow, llm.host);
    expect(llm.requests[0]).toMatchObject({ system: 'Hablas con Ana.', goal: 'Pide a Ana su email.' });
  });

  it('El host no altera la conversación', async () => {
    const llm = scriptedLlm([
      (request: LlmTurnRequest) => {
        request.history.length = 0;
        request.goal = 'otro objetivo';
        request.slots.length = 0;
        return turn('¿Me das tu email?');
      },
      turn('Gracias'),
    ]);
    const flow = llmFlow();
    const [, second] = await chat(flow, llm.host, [{ text: 'Hola' }]);
    expect(second!.status).toBe('waiting');
    expect(llm.requests[1]!.goal).toBe('Consigue el email del usuario.');
    expect(llm.requests[1]!.history).toEqual([
      { role: 'assistant', text: '¿Me das tu email?' },
      { role: 'user', text: 'Hola' },
    ]);
    expect(llm.requests[1]!.slots).toHaveLength(1);
  });
});

describe('Slots de la petición', () => {
  it('Slot repetido', async () => {
    const llm = alwaysLlm(turn('Hola'));
    const slots = [
      { variable: 'email', description: 'a' },
      { variable: 'email', description: 'b', required: false },
    ];
    await begin(llmFlow({ slots }), llm.host);
    expect(llm.requests[0]!.slots).toEqual([{ name: 'email', type: 'email', description: 'a', required: true, collected: false }]);
  });

  it('Slot recogido en la petición siguiente', async () => {
    const llm = scriptedLlm([turn('¿Me das tu email?', { email: 'ana@example.com' }, false), turn('Gracias')]);
    await chat(llmFlow(), llm.host, [{ text: 'Eso es' }]);
    expect(llm.requests[0]!.slots[0]!.collected).toBe(false);
    expect(llm.requests[1]!.slots[0]).toMatchObject({ name: 'email', collected: true });
  });
});

describe('Historial de la petición', () => {
  it('Segundo turno', async () => {
    const llm = alwaysLlm(turn('¿Me das tu email?'));
    const flow = llmFlow();
    const first = await begin(flow, llm.host);
    await proceed(flow, first.state, '  es ana@example.com  ', llm.host);
    expect(llm.requests[1]).toMatchObject({
      turn: 2,
      history: [
        { role: 'assistant', text: '¿Me das tu email?' },
        { role: 'user', text: 'es ana@example.com' },
      ],
    });
  });

  it('Mensajes inválidos fuera del historial', async () => {
    const llm = alwaysLlm(turn('¿Me das tu email?'));
    const flow = llmFlow();
    const first = await begin(flow, llm.host);
    const invalid = await proceed(flow, first.state, '   ', llm.host);
    expect(llm.requests).toHaveLength(1);
    await proceed(flow, invalid.state, 'Hola', llm.host);
    expect(llm.requests[1]!.history).toEqual([
      { role: 'assistant', text: '¿Me das tu email?' },
      { role: 'user', text: 'Hola' },
    ]);
  });
});
