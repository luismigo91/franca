import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TestDetailsPanel } from '@/components/chat/test-details-panel';
import { resourceOf } from '../../../tests/helpers/resources';

describe('TestDetailsPanel', () => {
  it('muestra el recurso: estado, error, coste, revisión y fechas', () => {
    const html = renderToStaticMarkup(
      <TestDetailsPanel
        conversation={resourceOf({ status: 'failed', pendingInput: null, error: { code: 'llm_not_configured', nodeId: 'asistente' }, costUsd: 0, revision: 3, contactId: 'c-1' })}
        activity={[]}
      />,
    );
    for (const text of ['Detalles de la prueba', 'Fallida', 'llm_not_configured', 'asistente', '0 USD', 'c-1', 'Tope de coste alcanzado', 'No', 'Revisión', '>3<', 'Sin actividad técnica']) expect(html).toContain(text);
  });

  it('el intento y el motivo de la pregunta pendiente', () => {
    const html = renderToStaticMarkup(
      <TestDetailsPanel conversation={resourceOf({ revision: 3, pendingInput: { type: 'input', nodeId: 'pedir-email', inputType: 'email', attempt: 2, reason: 'invalid_format' } })} activity={[]} />,
    );
    expect(html).toContain('Intento de la pregunta');
    expect(html).toContain('>2<');
    expect(html).toContain('invalid_format');
  });

  it('la actividad técnica en orden, sin ningún message', () => {
    const html = renderToStaticMarkup(
      <TestDetailsPanel
        conversation={resourceOf({ status: 'ended', pendingInput: null, outcome: 'lead-sin-enviar' })}
        activity={[
          { type: 'llm', nodeId: 'asistente', turns: 2, costUsd: 0.02, reason: null },
          { type: 'http', nodeId: 'enviar-crm', attempts: 1, status: null, error: 'blocked' },
          { type: 'error', nodeId: 'enviar-crm', code: 'missing_secret', message: 'MARCA-MENSAJE' } as never,
        ]}
      />,
    );
    expect(html.indexOf('LLM en asistente')).toBeGreaterThan(-1);
    expect(html.indexOf('LLM en asistente')).toBeLessThan(html.indexOf('HTTP en enviar-crm'));
    expect(html).toContain('2 turnos');
    expect(html).toContain('0.02 USD');
    expect(html).toContain('1 intento');
    expect(html).toContain('blocked');
    expect(html).toContain('missing_secret');
    expect(html).not.toContain('MARCA-MENSAJE');
    expect(html).not.toContain('Sin actividad técnica');
  });

  it('sin recurso solo muestra el título y la actividad', () => {
    const html = renderToStaticMarkup(<TestDetailsPanel conversation={null} activity={[]} />);
    expect(html).toContain('Detalles de la prueba');
    expect(html).not.toContain('<dl');
  });
});
