import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EndNotice } from '@/components/chat/end-notice';

const render = (status: 'ended' | 'failed' | 'expired', outcome: string | null = null, extra: object = {}) =>
  renderToStaticMarkup(<EndNotice conversation={{ status, outcome, ...extra } as Parameters<typeof EndNotice>[0]['conversation']} starting={false} onRestart={() => undefined} />);

describe('EndNotice', () => {
  it('terminada con su outcome', () => {
    const html = render('ended', 'completo');
    expect(html).toContain('Conversación terminada');
    expect(html).toContain('completo');
  });

  it('terminada sin outcome no lo menciona', () => {
    expect(render('ended')).not.toContain('Resultado');
  });

  it('fallida y caducada, con Empezar de nuevo y Volver al inicio', () => {
    for (const [status, title] of [['failed', 'La conversación no ha podido continuar'], ['expired', 'La conversación ha caducado por inactividad']] as const) {
      const html = render(status);
      expect(html).toContain(title);
      expect(html).toContain('Empezar de nuevo');
      expect(html).toContain('Volver al inicio');
      expect(html).toContain('href="/"');
    }
  });

  it('nunca incluye el message de un error aunque el objeto lo trajera', () => {
    const html = render('failed', null, { message: 'MARCA-MENSAJE: el host no tiene un secreto', error: { code: 'missing_secret', nodeId: 'enviar-crm', message: 'MARCA-MENSAJE' } });
    expect(html).not.toContain('MARCA-MENSAJE');
    expect(html).not.toContain('secreto');
  });
});
