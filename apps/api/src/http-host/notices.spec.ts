import { describe, expect, it } from 'vitest';
import { createLoggerNotices } from './notices.js';

describe('createLoggerNotices', () => {
  const lines: string[] = [];
  const notices = createLoggerNotices({ warn: (message) => void lines.push(message) });

  it('missing_secret: id, nodo, nombre del secreto y motivo, con las palabras fijas', () => {
    lines.length = 0;
    notices.missingSecret({ conversationId: 'c-1', nodeId: 'enviar-crm', secret: 'CRM_TOKEN', reason: 'not_configured' });
    notices.missingSecret({ conversationId: 'c-2', nodeId: 'enviar-crm', secret: 'CRM_TOKEN', reason: 'origin_not_allowed' });
    expect(lines).toEqual([
      'conversación c-1: missing_secret en el nodo enviar-crm, secreto CRM_TOKEN (not_configured)',
      'conversación c-2: missing_secret en el nodo enviar-crm, secreto CRM_TOKEN (origin_not_allowed)',
    ]);
  });

  it('blocked: id, nodo y motivo, y nada más', () => {
    lines.length = 0;
    notices.blocked({ conversationId: 'c-1', nodeId: 'enviar-crm', reason: 'internal_destination' });
    notices.blocked({ conversationId: 'c-1', nodeId: 'enviar-crm', reason: 'insecure_transport' });
    expect(lines).toEqual(['conversación c-1: blocked en el nodo enviar-crm (internal_destination)', 'conversación c-1: blocked en el nodo enviar-crm (insecure_transport)']);
  });
});
