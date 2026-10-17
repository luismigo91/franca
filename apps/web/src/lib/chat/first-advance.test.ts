import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFirstAdvance, peekFirstAdvance, setFirstAdvance, startConversation } from '@/lib/chat/first-advance';
import type { WebClient } from '@/lib/web-client';
import { advanceOf, messageEvent } from '../../../tests/helpers/resources';

afterEach(() => clearFirstAdvance());

describe('first-advance', () => {
  it('guarda solo el último traspaso y se lee sin consumirse', () => {
    const one = advanceOf({ id: 'a' }, []);
    const two = advanceOf({ id: 'b' }, []);
    setFirstAdvance({ conversationId: 'a', ...one });
    setFirstAdvance({ conversationId: 'b', ...two });
    expect(peekFirstAdvance('a')).toBeNull();
    expect(peekFirstAdvance('b')?.conversation.id).toBe('b');
    expect(peekFirstAdvance('b')?.conversation.id).toBe('b');
    clearFirstAdvance('a');
    expect(peekFirstAdvance('b')).not.toBeNull();
    clearFirstAdvance('b');
    expect(peekFirstAdvance('b')).toBeNull();
  });

  it('startConversation guarda el avance en memoria y navega a la conversación creada', async () => {
    const body = advanceOf({ id: '00000000-0000-4000-8000-000000000009' }, [messageEvent('a', 'Hola')]);
    const client = { createConversation: vi.fn<WebClient['createConversation']>(async () => ({ ok: true, status: 201, body })) };
    const navigate = vi.fn<(path: string) => void>();
    expect(await startConversation(client, 'pregunta', 'c-1', navigate)).toEqual({ ok: true, conversationId: '00000000-0000-4000-8000-000000000009' });
    expect(client.createConversation).toHaveBeenCalledWith('pregunta', 'c-1');
    expect(navigate).toHaveBeenCalledWith('/conversaciones/00000000-0000-4000-8000-000000000009');
    expect(peekFirstAdvance('00000000-0000-4000-8000-000000000009')?.events).toHaveLength(1);
  });

  it('si falla no navega ni guarda nada, y devuelve el código', async () => {
    const client = { createConversation: vi.fn<WebClient['createConversation']>(async () => ({ ok: false, status: 404, code: 'flow_not_found' })) };
    const navigate = vi.fn<(path: string) => void>();
    expect(await startConversation(client, 'pregunta', '', navigate)).toEqual({ ok: false, code: 'flow_not_found' });
    expect(navigate).not.toHaveBeenCalled();
    expect(peekFirstAdvance('x')).toBeNull();
  });
});
