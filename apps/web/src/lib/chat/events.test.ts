import { describe, expect, it } from 'vitest';
import { readContent, readEvent, readEvents, readPendingQuestion } from '@/lib/chat/events';
import { KNOWN_EVENT_TYPES } from '@/lib/chat/known-types';
import { FLOWS, runFlow } from '../../../tests/helpers/engine-events';

describe('events', () => {
  it('lee los eventos reales de captacion-leads: bienvenida, pedir-nombre y el input de texto', async () => {
    const [first] = await runFlow(FLOWS['captacion-leads']);
    const events = readEvents(first!.events);
    expect(events).toHaveLength(first!.events.length);
    expect(events.map((event) => event.type)).toEqual(['message', 'message', 'input']);
    expect(events[0]).toMatchObject({ type: 'message', nodeId: 'bienvenida', typingDelayMs: 600 });
    expect(events[2]).toMatchObject({ type: 'input', nodeId: 'pedir-nombre', kind: 'text', inputType: 'text', attempt: 1, reason: null });
  });

  it('lee el reintento de pedir-email: attempt 2 con reason invalid_format', async () => {
    const steps = await runFlow(FLOWS['captacion-leads'], [{ text: 'Ana' }, { text: 'ana@' }]);
    const events = readEvents(steps[2]!.events);
    expect(events.at(-1)).toMatchObject({ type: 'input', nodeId: 'pedir-email', kind: 'text', inputType: 'email', attempt: 2, reason: 'invalid_format' });
  });

  it('lee las preguntas del flujo preguntas: los siete tipos de texto con placeholder y el choice múltiple', async () => {
    const inputs = [{ text: ' hola ' }, { text: 'a@b.co' }, { text: '+34 600 000 000' }, { text: '5' }, { text: 'https://example.com' }, { text: '2026-10-17' }, { text: 'sí' }];
    const steps = await runFlow(FLOWS.preguntas, inputs);
    const questions = steps.map((step) => readEvents(step.events).find((event) => event.type === 'input'));
    expect(questions.map((question) => (question && question.type === 'input' ? (question.kind === 'choice' ? 'choice' : question.inputType) : null))).toEqual([
      'text', 'email', 'phone', 'number', 'url', 'date', 'boolean', 'choice',
    ]);
    expect(questions[0]).toMatchObject({ kind: 'text', placeholder: 'Escribe algo' });
    const plan = questions[7];
    expect(plan).toMatchObject({ kind: 'choice', multiple: false });
    expect(plan && plan.type === 'input' && plan.kind === 'choice' ? plan.choices.map((choice) => choice.id) : []).toEqual(['basico', 'pro']);
    const extras = readEvents((await runFlow(FLOWS.preguntas, [...inputs, { choice: 'basico' }])).at(-1)!.events).find((event) => event.type === 'input');
    expect(extras).toMatchObject({ kind: 'choice', multiple: true });
  });

  it('lee el contenido del flujo medios: cinco imágenes de las cuales se conservan sus url tal cual', async () => {
    const [first] = await runFlow(FLOWS.medios);
    const message = readEvents(first!.events).find((event) => event.type === 'message');
    expect(message && message.type === 'message' ? message.content.map((item) => item.kind) : []).toEqual([
      'text', 'image', 'image', 'image', 'image', 'video', 'audio', 'embed', 'embed',
    ]);
    expect(message && message.type === 'message' ? message.content[2] : null).toEqual({ kind: 'image', url: 'javascript:alert(1)', alt: 'Malo' });
  });

  it('lee el fin de pregunta: end con outcome', async () => {
    const steps = await runFlow(FLOWS.pregunta, [{ text: 'Ana' }]);
    expect(readEvents(steps[1]!.events).at(-1)).toEqual({ type: 'end', nodeId: 'fin', outcome: 'ok' });
  });

  it('todos los tipos de los eventos reales están en KNOWN_EVENT_TYPES', async () => {
    const all = [
      ...(await runFlow(FLOWS['captacion-leads'], [{ text: 'Ana' }, { text: 'ana@example.com' }, { choice: 'grande' }])),
      ...(await runFlow(FLOWS.preguntas)),
      ...(await runFlow(FLOWS.medios)),
      ...(await runFlow(FLOWS.pregunta, [{ text: 'Ana' }])),
    ].flatMap((step) => step.events);
    expect(all.length).toBeGreaterThan(10);
    for (const event of all) expect(KNOWN_EVENT_TYPES as readonly string[]).toContain(event.type);
    expect(all.some((event) => event.type === 'error')).toBe(true);
  });

  it('un error nunca conserva su message', async () => {
    const steps = await runFlow(FLOWS['captacion-leads'], [{ text: 'Ana' }, { text: 'ana@example.com' }, { choice: 'grande' }]);
    const raw = steps.at(-1)!.events.find((event) => event.type === 'error');
    expect(raw).toBeDefined();
    expect(raw && 'message' in raw ? raw.message : '').not.toBe('');
    const read = readEvent(raw);
    expect(read).toEqual({ type: 'error', nodeId: raw!.nodeId, code: 'unsupported_node' });
    expect(JSON.stringify(read)).not.toContain('message');
  });

  it('ignora sin lanzar los tipos y las formas desconocidas o rotas', () => {
    const broken: unknown[] = [
      null, undefined, 3, 'x', [], {}, { type: 'nuevo', nodeId: 'x' }, { type: 'message' }, { type: 'message', nodeId: 3 },
      { type: 'error', nodeId: 'x' }, { type: 'input', nodeId: 'x', inputType: 'text', attempt: 'uno' },
    ];
    expect(() => readEvents(broken)).not.toThrow();
    expect(readEvents(broken).map((event) => event.type)).toEqual(['input']);
    expect(readEvents('no es una lista')).toEqual([]);
  });

  it('el contenido ignora los kind desconocidos y las formas rotas', () => {
    expect(readContent([{ kind: 'mapa', url: 'https://example.com/m' }, { kind: 'text', text: 'Sigo' }, { kind: 'text' }, null, 4, { kind: 'image' }])).toEqual([
      { kind: 'text', text: 'Sigo' },
      { kind: 'image', url: '' },
    ]);
    expect(readContent('no')).toEqual([]);
  });

  it('un inputType desconocido es unsupported, y un choice sin opciones legibles también', () => {
    expect(readPendingQuestion({ type: 'input', nodeId: 'q', inputType: 'firma', attempt: 1, reason: null })).toMatchObject({ kind: 'unsupported', inputType: 'firma' });
    expect(readPendingQuestion({ type: 'input', nodeId: 'q', inputType: 'choice', attempt: 1, reason: null, choices: [{ id: 1 }] })).toMatchObject({ kind: 'unsupported' });
    expect(readPendingQuestion({ type: 'message', nodeId: 'q' })).toBeNull();
    expect(readPendingQuestion(null)).toBeNull();
  });
});
