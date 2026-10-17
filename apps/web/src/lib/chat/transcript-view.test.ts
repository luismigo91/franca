import { describe, expect, it } from 'vitest';
import type { Page, TranscriptItem } from '@/lib/chat/api-types';
import { buildTranscriptView, pendingFromResource, readFullTranscript, userInputText } from '@/lib/chat/transcript-view';
import { FLOWS, runFlow } from '../../../tests/helpers/engine-events';
import type { ClientResult } from '@/lib/web-client';

const AT = '2026-10-17T10:30:00.000Z';
const flow = (seq: number, event: unknown): TranscriptItem => ({ seq, at: AT, role: 'flow', event });
const user = (seq: number, input: unknown): TranscriptItem => ({ seq, at: AT, role: 'user', input });
const message = (nodeId: string, text: string) => ({ type: 'message', nodeId, content: [{ kind: 'text', text }], typingDelayMs: 600 });

/** La transcripción tal como la guarda la API: la entrada del usuario y después cada evento tal cual. */
async function transcriptOf(flowJson: unknown, inputs: unknown[]): Promise<TranscriptItem[]> {
  const steps = await runFlow(flowJson, inputs);
  const items: TranscriptItem[] = [];
  let seq = 1;
  steps.forEach((step, index) => {
    if (index > 0) items.push(user(seq++, inputs[index - 1]));
    for (const event of step.events) items.push(flow(seq++, event));
  });
  return items;
}

describe('transcript-view', () => {
  it('ordena por seq y reconstruye mensajes y respuestas del flujo real', async () => {
    const items = await transcriptOf(FLOWS['captacion-leads'], [{ text: ' Ana ' }, { text: 'ana@' }]);
    const view = buildTranscriptView([...items].reverse());
    const kinds = view.timeline.map((item) => (item.kind === 'user' ? `user:${item.text}` : `flow:${item.nodeId}`));
    expect(kinds).toEqual(['flow:bienvenida', 'flow:pedir-nombre', 'user: Ana ', 'flow:pedir-email', 'user:ana@', 'flow:pedir-email']);
  });

  it('pinta el label de choice y los de choices en el orden de las opciones, separados por coma', async () => {
    const inputs = [{ text: 'a' }, { text: 'a@b.co' }, { text: '+34 600 000 000' }, { text: '5' }, { text: 'https://example.com' }, { text: '2026-10-17' }, { text: 'sí' }, { choice: 'pro' }, { choices: ['c', 'a'] }];
    const view = buildTranscriptView(await transcriptOf(FLOWS.preguntas, inputs));
    const users = view.timeline.filter((item) => item.kind === 'user').map((item) => (item.kind === 'user' ? item.text : ''));
    expect(users.slice(-2)).toEqual(['Pro', 'Soporte, Informes']);
  });

  it('un id desconocido se pinta como su id y una forma desconocida no se pinta', () => {
    const question = { type: 'input', nodeId: 'p', inputType: 'choice', attempt: 1, reason: null, multiple: true, choices: [{ id: 'a', label: 'Soporte' }] };
    const view = buildTranscriptView([flow(1, question), user(2, { choices: ['zzz', 'a'] }), user(3, { choice: 'otro' }), user(4, { forma: 1 }), user(5, 'texto suelto')]);
    expect(view.timeline).toEqual([
      { kind: 'user', key: 't2', text: 'Soporte, zzz' },
      { kind: 'user', key: 't3', text: 'otro' },
    ]);
    expect(userInputText({ choice: 'a' }, null)).toBe('a');
  });

  it('http, llm y error van a la actividad sin message, y ni http ni llm van al timeline', () => {
    const view = buildTranscriptView([
      flow(1, { type: 'llm', nodeId: 'asistente', turns: 2, costUsd: 0.02, reason: null }),
      flow(2, { type: 'http', nodeId: 'enviar-crm', attempts: 1, status: null, error: 'blocked' }),
      flow(3, { type: 'error', nodeId: 'enviar-crm', code: 'missing_secret', message: 'MARCA-MENSAJE: el host no tiene un secreto' }),
      flow(4, { type: 'end', nodeId: 'fin', outcome: 'lead-sin-enviar' }),
    ]);
    expect(view.timeline).toEqual([]);
    expect(view.activity).toEqual([
      { type: 'llm', nodeId: 'asistente', turns: 2, costUsd: 0.02, reason: null },
      { type: 'http', nodeId: 'enviar-crm', attempts: 1, status: null, error: 'blocked' },
      { type: 'error', nodeId: 'enviar-crm', code: 'missing_secret' },
    ]);
    expect(JSON.stringify(view)).not.toContain('MARCA-MENSAJE');
  });

  it('ignora eventos y contenido desconocidos y entradas rotas', () => {
    const view = buildTranscriptView([flow(1, { type: 'nuevo', nodeId: 'x' }), flow(2, { type: 'message', nodeId: 'a', content: [{ kind: 'mapa', url: 'x' }, { kind: 'text', text: 'Sigo' }], typingDelayMs: 0 }), flow(3, null)]);
    expect(view.timeline).toEqual([{ kind: 'flow', key: 't2', nodeId: 'a', content: [{ kind: 'text', text: 'Sigo' }] }]);
  });

  it('la pregunta pendiente sale del recurso, no del último input de la transcripción', () => {
    const pending = { type: 'input', nodeId: 'p', inputType: 'text', attempt: 2, reason: 'required' };
    expect(pendingFromResource({ status: 'waiting', pendingInput: pending })).toMatchObject({ nodeId: 'p', attempt: 2, reason: 'required' });
    expect(pendingFromResource({ status: 'expired', pendingInput: pending })).toBeNull();
    expect(pendingFromResource({ status: 'waiting', pendingInput: null })).toBeNull();
  });
});

function pagesOf(total: number, calls: number[], changeAfter?: { call: number; total: number }) {
  return async (offset: number): Promise<ClientResult<Page<TranscriptItem>>> => {
    calls.push(offset);
    const current = changeAfter && calls.length > changeAfter.call ? changeAfter.total : total;
    const items = Array.from({ length: Math.max(0, Math.min(100, current - offset)) }, (_, index) => flow(offset + index + 1, message('n', `m${offset + index + 1}`)));
    return { ok: true, status: 200, body: { items, total: current, limit: 100, offset } };
  };
}

describe('readFullTranscript', () => {
  it('lee 150 entradas en dos páginas con offset 0 y 100', async () => {
    const calls: number[] = [];
    const result = await readFullTranscript(pagesOf(150, calls));
    expect(calls).toEqual([0, 100]);
    expect(result.ok && result.body).toHaveLength(150);
    expect(result.ok && result.body.map((item) => item.seq)).toEqual(Array.from({ length: 150 }, (_, index) => index + 1));
  });

  it('si total cambia entre páginas, empieza de nuevo', async () => {
    const calls: number[] = [];
    const result = await readFullTranscript(pagesOf(150, calls, { call: 1, total: 160 }));
    expect(calls).toEqual([0, 100, 0, 100]);
    expect(result.ok && result.body).toHaveLength(160);
  });

  it('si total no deja de cambiar, termina con un fallo tras tres reinicios', async () => {
    let call = 0;
    const result = await readFullTranscript(async (offset) => {
      call++;
      const total = 150 + call;
      return { ok: true, status: 200, body: { items: Array.from({ length: Math.min(100, total - offset) }, (_, index) => flow(offset + index + 1, message('n', 'x'))), total, limit: 100, offset } };
    });
    expect(result).toEqual({ ok: false, status: 200, code: 'invalid_api_response' });
    expect(call).toBe(8);
  });

  it('devuelve el primer fallo de una página', async () => {
    const result = await readFullTranscript(async (offset) =>
      offset === 0 ? { ok: true, status: 200, body: { items: [flow(1, message('n', 'x'))], total: 150, limit: 100, offset } } : { ok: false, status: 502, code: 'api_unreachable' },
    );
    expect(result).toEqual({ ok: false, status: 502, code: 'api_unreachable' });
  });

  it('una página vacía antes del total no provoca un bucle', async () => {
    const calls: number[] = [];
    const result = await readFullTranscript(async (offset) => {
      calls.push(offset);
      return { ok: true, status: 200, body: { items: [], total: 5, limit: 100, offset } };
    });
    expect(calls).toEqual([0]);
    expect(result.ok && result.body).toEqual([]);
  });
});
