import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PendingQuestion } from '@/components/chat/pending-question';
import { readPendingQuestion, type PendingQuestion as Question } from '@/lib/chat/events';
import { FLOWS, runFlow } from '../../../tests/helpers/engine-events';

function question(value: unknown): Question {
  const read = readPendingQuestion(value);
  if (read === null) throw new Error('no es una pregunta');
  return read;
}

const text = (inputType: string, extra: object = {}) => question({ type: 'input', nodeId: 'q', inputType, attempt: 1, reason: null, ...extra });
const render = (q: Question, draft: Parameters<typeof PendingQuestion>[0]['draft'] = null, disabled = false) =>
  renderToStaticMarkup(<PendingQuestion question={q} draft={draft} disabled={disabled} onSend={() => undefined} />);

describe('PendingQuestion', () => {
  it('text usa un textarea con el placeholder del evento', () => {
    const html = render(text('text', { placeholder: 'Escribe algo' }));
    expect(html).toContain('<textarea');
    expect(html).toContain('placeholder="Escribe algo"');
    expect(html).not.toContain('<input');
  });

  it.each([
    ['email', 'inputMode="email"', 'autoCapitalize="none"'],
    ['phone', 'inputMode="tel"', null],
    ['number', 'inputMode="decimal"', null],
    ['url', 'inputMode="url"', 'autoCapitalize="none"'],
    ['date', 'inputMode="text"', null],
    ['boolean', 'inputMode="text"', null],
  ] as const)('%s usa un input de texto con %s y nunca type email, url, number ni date', (inputType, mode, capitalize) => {
    const html = render(text(inputType));
    expect(html).toContain('type="text"');
    expect(html.toLowerCase()).toContain(mode.toLowerCase());
    if (capitalize) expect(html.toLowerCase()).toContain(capitalize.toLowerCase());
    else expect(html.toLowerCase()).not.toContain('autocapitalize');
    for (const type of ['email', 'url', 'number', 'date', 'tel']) expect(html).not.toContain(`type="${type}"`);
    expect(html).not.toContain('<textarea');
    expect(html.toLowerCase()).toContain('autocomplete="off"');
    expect(html.toLowerCase()).toContain('spellcheck="false"');
  });

  it('ningún control lleva maxlength, required, pattern, min, max ni el formulario action o method', () => {
    for (const html of [render(text('text')), render(text('email')), render(text('number')), render(question({ type: 'input', nodeId: 'q', inputType: 'choice', attempt: 1, reason: null, multiple: true, choices: [{ id: 'a', label: 'A' }] }))]) {
      for (const attribute of ['maxlength', 'required', 'pattern=', ' min=', ' max=', 'action=', 'method=']) expect(html.toLowerCase()).not.toContain(attribute);
      expect(html.toLowerCase()).toContain('novalidate');
    }
  });

  it('selección única: un botón por opción en orden y ningún campo de texto', async () => {
    const steps = await runFlow(FLOWS['captacion-leads'], [{ text: 'Ana' }, { text: 'ana@example.com' }]);
    const input = steps.at(-1)!.events.find((event) => event.type === 'input');
    const html = render(question(input));
    expect(html.indexOf('1 a 10')).toBeGreaterThan(-1);
    expect(html.indexOf('1 a 10')).toBeLessThan(html.indexOf('11 a 50'));
    expect(html.indexOf('11 a 50')).toBeLessThan(html.indexOf('Más de 50'));
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('type="submit"');
  });

  it('selección múltiple: una casilla por opción en orden y Enviar', async () => {
    const inputs = [{ text: 'a' }, { text: 'a@b.co' }, { text: '+34 600 000 000' }, { text: '5' }, { text: 'https://example.com' }, { text: '2026-10-17' }, { text: 'sí' }, { choice: 'pro' }];
    const steps = await runFlow(FLOWS.preguntas, inputs);
    const html = render(question(steps.at(-1)!.events.find((event) => event.type === 'input')));
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.indexOf('Soporte')).toBeLessThan(html.indexOf('Formación'));
    expect(html.indexOf('Formación')).toBeLessThan(html.indexOf('Informes'));
    expect(html).toContain('type="submit"');
    expect(html).toContain('>Enviar<');
  });

  it('una opción con imagen admitida la pinta y la que no se admite va sin imagen, sin ningún javascript:', async () => {
    const inputs = [{ text: 'a' }, { text: 'a@b.co' }, { text: '+34 600 000 000' }, { text: '5' }, { text: 'https://example.com' }, { text: '2026-10-17' }, { text: 'sí' }];
    const steps = await runFlow(FLOWS.preguntas, inputs);
    const html = render(question(steps.at(-1)!.events.find((event) => event.type === 'input')));
    expect(html).toContain('src="https://example.com/basico.png"');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('Pro');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('alt=""');
  });

  it('un inputType desconocido no tiene controles', () => {
    const html = render(question({ type: 'input', nodeId: 'q', inputType: 'firma', attempt: 1, reason: null }));
    expect(html).toContain('Esta pregunta no se puede responder desde el chat de prueba.');
    for (const control of ['<input', '<textarea', '<button', '<form', '<select']) expect(html).not.toContain(control);
  });

  it('el aviso del motivo va encima y enlazado con aria-describedby; sin motivo no hay aviso', () => {
    const html = render(text('email', { reason: 'invalid_format' }));
    expect(html).toContain('id="answer-reason"');
    expect(html).toContain('La respuesta no tiene el formato esperado.');
    expect(html).toContain('aria-describedby="answer-reason"');
    expect(render(text('email'))).not.toContain('answer-reason');
    expect(render(text('email', { reason: 'motivo_nuevo' }))).toContain('La respuesta no es válida.');
  });

  it('el motivo se anuncia al enfocar cada control de una pregunta de opción: aria-describedby en cada botón y casilla', () => {
    const single = question({ type: 'input', nodeId: 'q', inputType: 'choice', attempt: 2, reason: 'required', multiple: false, choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    const multiple = question({ type: 'input', nodeId: 'q', inputType: 'choice', attempt: 2, reason: 'required', multiple: true, choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    expect(render(single).match(/aria-describedby="answer-reason"/g)).toHaveLength(2);
    expect(render(multiple).match(/aria-describedby="answer-reason"/g)).toHaveLength(2);
    expect(render({ ...single, reason: null })).not.toContain('aria-describedby');
  });

  it('recupera el borrador: el texto en el campo y, en la múltiple, solo las opciones que siguen existiendo', () => {
    expect(render(text('text'), { text: 'Ana' })).toContain('>Ana</textarea>');
    expect(render(text('email'), { text: 'ana@' })).toContain('value="ana@"');
    const multiple = question({ type: 'input', nodeId: 'q', inputType: 'choice', attempt: 1, reason: null, multiple: true, choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    const html = render(multiple, { choices: ['b', 'zzz'] });
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/value="b"[^>]*checked=""|checked=""[^>]*value="b"/);
  });

  it('mientras se envía, los controles son inertes pero no `disabled` (un control disabled enfocado pierde el foco)', () => {
    const single = question({ type: 'input', nodeId: 'q', inputType: 'choice', attempt: 1, reason: null, multiple: false, choices: [{ id: 'a', label: 'A' }] });
    const multiple = question({ type: 'input', nodeId: 'q', inputType: 'choice', attempt: 1, reason: null, multiple: true, choices: [{ id: 'a', label: 'A' }] });
    for (const html of [render(text('text'), null, true), render(text('email'), null, true), render(single, null, true), render(multiple, null, true)]) {
      expect(html).toContain('aria-disabled="true"');
      expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    }
    expect(render(text('text'), null, true)).toContain('readOnly');
    expect(render(text('text'), null, false)).not.toContain('aria-disabled="');
  });

  it('el formulario no tiene action ni method (la guarda estática lo comprueba también sobre el código)', () => {
    for (const html of [render(text('text')), render(text('boolean'))]) expect(html).not.toMatch(/<form[^>]*\b(action|method)=/);
  });
});
