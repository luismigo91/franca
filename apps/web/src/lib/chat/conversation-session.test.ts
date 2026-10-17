import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdvanceBody, ConversationResource, Page, TranscriptItem } from '@/lib/chat/api-types';
import { ConversationSession, defaultSleep, type ConversationSnapshot, type SessionClient } from '@/lib/chat/conversation-session';
import { clearFirstAdvance, peekFirstAdvance } from '@/lib/chat/first-advance';
import type { ClientResult } from '@/lib/web-client';
import {
  CONVERSATION_ID,
  advanceOf,
  flowItem,
  messageEvent,
  pageOf,
  resourceOf,
  textInputEvent,
  userItem,
} from '../../../tests/helpers/resources';

const ok = <T>(body: T, status = 200): ClientResult<T> => ({ ok: true, status, body });
const fail = (code: Extract<ClientResult<never>, { ok: false }>['code'], status: number | null = 409, currentRevision?: number): ClientResult<never> =>
  currentRevision === undefined ? { ok: false, status, code } : { ok: false, status, code, currentRevision };

/** Lo que "guarda la API" en un test: se cambia entre pasos. */
interface World {
  conversation: ConversationResource;
  items: TranscriptItem[];
}

interface Fixture {
  session: ConversationSession;
  world: World;
  client: { [K in keyof SessionClient]: ReturnType<typeof vi.fn<SessionClient[K]>> };
  navigate: ReturnType<typeof vi.fn<(path: string) => void>>;
  sleeps: number[];
  snapshot: () => ConversationSnapshot;
}

function setup(options: { world?: Partial<World>; initial?: AdvanceBody | null; autoAcknowledge?: boolean } = {}): Fixture {
  const world: World = {
    conversation: resourceOf(),
    items: [flowItem(1, messageEvent('p', '¿Nombre?')), flowItem(2, textInputEvent('p'))],
    ...options.world,
  };
  const client = {
    getConversation: vi.fn<SessionClient['getConversation']>(async () => ok(world.conversation)),
    getTranscriptPage: vi.fn<SessionClient['getTranscriptPage']>(async (_id, offset): Promise<ClientResult<Page<TranscriptItem>>> => ok(pageOf(world.items.slice(offset, offset + 100), world.items.length, offset))),
    getFlowVersion: vi.fn<SessionClient['getFlowVersion']>(async (flowId, version) => ok({ flowId, version, name: 'Pregunta' })),
    sendInput: vi.fn<SessionClient['sendInput']>(async () => fail('network_error', null)),
    deleteConversation: vi.fn<SessionClient['deleteConversation']>(async () => ok(null, 204)),
    createConversation: vi.fn<SessionClient['createConversation']>(async () => fail('unknown', 500)),
  };
  const navigate = vi.fn<(path: string) => void>();
  const sleeps: number[] = [];
  const initial = options.initial ? { conversationId: options.initial.conversation.id, conversation: options.initial.conversation, events: options.initial.events } : null;
  const session = new ConversationSession(CONVERSATION_ID, {
    client,
    navigate,
    initial,
    autoAcknowledge: options.autoAcknowledge ?? true,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { session, world, client, navigate, sleeps, snapshot: () => session.getSnapshot() };
}

/** Deja correr las promesas pendientes (la sesión solo programa esperas de reproducción). */
const settle = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};

async function opened(options: Parameters<typeof setup>[0] = {}) {
  const fixture = setup(options);
  const stop = fixture.session.activate();
  await settle();
  return { ...fixture, stop };
}

const texts = (snapshot: ConversationSnapshot) => snapshot.timeline.map((item) => (item.kind === 'user' ? `u:${item.text}` : `f:${item.content.map((c) => (c.kind === 'text' ? c.text : c.kind)).join('|')}`));

afterEach(() => {
  clearFirstAdvance();
  vi.useRealTimers();
});

describe('abrir', () => {
  it('lee el recurso, el nombre de la versión y la transcripción sin retardos ni indicador', async () => {
    const { snapshot, client, sleeps } = await opened();
    expect(snapshot().phase).toBe('ready');
    expect(snapshot().header).toEqual({ title: 'Pregunta', version: 1 });
    expect(texts(snapshot())).toEqual(['f:¿Nombre?']);
    expect(snapshot().pending).toMatchObject({ nodeId: 'p', kind: 'text' });
    expect(snapshot().typing).toBe(false);
    expect(sleeps).toEqual([]);
    expect(client.getFlowVersion).toHaveBeenCalledWith('pregunta', 1, expect.anything());
  });

  it('el flujo borrado o ilegible usa el flowId como título', async () => {
    const fixture = setup();
    fixture.client.getFlowVersion.mockResolvedValue(fail('flow_not_found', 404));
    fixture.session.activate();
    await settle();
    expect(fixture.snapshot().header).toEqual({ title: 'pregunta', version: 1 });
  });

  it('una conversación que no existe es not_found; otro fallo es load_error con su código', async () => {
    const missing = setup();
    missing.client.getConversation.mockResolvedValue(fail('conversation_not_found', 404));
    missing.session.activate();
    await settle();
    expect(missing.snapshot().phase).toBe('not_found');

    const down = setup();
    down.client.getConversation.mockResolvedValue(fail('api_unreachable', 502));
    down.session.activate();
    await settle();
    expect(down.snapshot()).toMatchObject({ phase: 'load_error', loadError: 'api_unreachable' });
    down.client.getConversation.mockResolvedValue(ok(down.world.conversation));
    down.session.retryLoad();
    await settle();
    expect(down.snapshot().phase).toBe('ready');
  });

  it('un fallo de la transcripción al abrir es load_error', async () => {
    const fixture = setup();
    fixture.client.getTranscriptPage.mockResolvedValue(fail('database_unavailable', 503));
    fixture.session.activate();
    await settle();
    expect(fixture.snapshot()).toMatchObject({ phase: 'load_error', loadError: 'database_unavailable' });
  });

  it('con processing true avisa de que está ocupada y ofrece volver a cargar', async () => {
    const { snapshot } = await opened({ world: { conversation: resourceOf({ processing: true }) } });
    expect(snapshot().notice).toEqual({ kind: 'busy', text: 'La conversación está procesando otra respuesta.', action: 'reload' });
  });

  it('el estado final quita la pregunta pendiente', async () => {
    const { snapshot } = await opened({ world: { conversation: resourceOf({ status: 'ended', outcome: 'ok', pendingInput: null }) } });
    expect(snapshot().pending).toBeNull();
    expect(snapshot().settled).toBe(true);
  });

  it('la actividad técnica sale de la transcripción y nunca contiene el message', async () => {
    const { snapshot } = await opened({
      world: {
        conversation: resourceOf({ status: 'failed', pendingInput: null, error: { code: 'missing_secret', nodeId: 'enviar-crm' } }),
        items: [
          flowItem(1, { type: 'http', nodeId: 'enviar-crm', attempts: 1, status: null, error: 'blocked' }),
          flowItem(2, { type: 'error', nodeId: 'enviar-crm', code: 'missing_secret', message: 'MARCA-MENSAJE' }),
        ],
      },
    });
    expect(snapshot().activity.map((item) => item.type)).toEqual(['http', 'error']);
    expect(JSON.stringify(snapshot())).not.toContain('MARCA-MENSAJE');
  });
});

describe('ritmo de los mensajes', () => {
  const firstAdvance = advanceOf({ revision: 1 }, [messageEvent('bienvenida', 'Hola', 600), messageEvent('pedir', '¿Nombre?', 600), textInputEvent('pedir')]);

  beforeEach(() => vi.useFakeTimers());

  it('espera typingDelayMs antes de cada mensaje, con el indicador, y la pregunta aparece después del último', async () => {
    const fixture = setup({ initial: firstAdvance, autoAcknowledge: true });
    fixture.session.activate();
    // Se sustituye el sleep falso por la espera real con temporizadores falsos.
    const real = new ConversationSession(CONVERSATION_ID, {
      client: fixture.client,
      navigate: fixture.navigate,
      initial: { conversationId: CONVERSATION_ID, conversation: firstAdvance.conversation, events: firstAdvance.events },
      autoAcknowledge: true,
      sleep: defaultSleep,
    });
    real.activate();
    await vi.advanceTimersByTimeAsync(0);
    expect(real.getSnapshot().typing).toBe(true);
    expect(real.getSnapshot().timeline).toEqual([]);
    expect(real.getSnapshot().pending).toBeNull();
    await vi.advanceTimersByTimeAsync(599);
    expect(real.getSnapshot().timeline).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(texts(real.getSnapshot())).toEqual(['f:Hola']);
    expect(real.getSnapshot().pending).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(real.getSnapshot().typing).toBe(true);
    await vi.advanceTimersByTimeAsync(598);
    expect(texts(real.getSnapshot())).toEqual(['f:Hola']);
    await vi.advanceTimersByTimeAsync(1);
    expect(texts(real.getSnapshot())).toEqual(['f:Hola', 'f:¿Nombre?']);
    expect(real.getSnapshot()).toMatchObject({ typing: false, settled: true });
    expect(real.getSnapshot().pending).toMatchObject({ nodeId: 'p', kind: 'text' });
  });

  it('con typingDelayMs 0 pinta enseguida y no enciende el indicador', async () => {
    const instant = advanceOf({}, [messageEvent('a', 'Uno'), messageEvent('b', 'Dos'), textInputEvent('p')]);
    const { snapshot, sleeps } = await opened({ initial: instant });
    expect(texts(snapshot())).toEqual(['f:Uno', 'f:Dos']);
    expect(sleeps).toEqual([]);
    expect(snapshot().typing).toBe(false);
    expect(snapshot().pending).not.toBeNull();
  });

  it('la espera del mensaje siguiente empieza cuando la vista confirma el anterior', async () => {
    const fixture = setup({ initial: firstAdvance, autoAcknowledge: false });
    fixture.session.activate();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    // El sleep falso resuelve ya: el primer mensaje se pinta y la sesión espera la confirmación de la vista.
    const first = fixture.snapshot().timeline[0];
    expect(first?.key).toBeDefined();
    expect(fixture.snapshot().timeline).toHaveLength(1);
    await settle();
    expect(fixture.snapshot().timeline).toHaveLength(1);
    fixture.session.acknowledge(first!.key);
    await settle();
    expect(fixture.snapshot().timeline).toHaveLength(2);
    expect(fixture.snapshot().pending).toBeNull();
    fixture.session.acknowledge(fixture.snapshot().timeline[1]!.key);
    await settle();
    expect(fixture.snapshot().pending).not.toBeNull();
  });

  it('el indicador se ve mientras la API responde a una entrada y desaparece al pintar el primer mensaje', async () => {
    const fixture = await opened();
    let release: (value: ClientResult<AdvanceBody>) => void = () => undefined;
    fixture.client.sendInput.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const sent = fixture.session.send({ text: 'Ana' }, 'Ana');
    await settle();
    expect(fixture.snapshot()).toMatchObject({ typing: true, sending: true });
    expect(texts(fixture.snapshot())).toEqual(['f:¿Nombre?', 'u:Ana']);
    release(ok(advanceOf({ revision: 2, status: 'ended', outcome: 'ok', pendingInput: null }, [messageEvent('fin', 'Adiós'), { type: 'end', nodeId: 'fin', outcome: 'ok' }])));
    await sent;
    expect(texts(fixture.snapshot())).toEqual(['f:¿Nombre?', 'u:Ana', 'f:Adiós']);
    expect(fixture.snapshot()).toMatchObject({ typing: false, sending: false, settled: true, pending: null });
  });
});

describe('enviar', () => {
  it('manda If-Match con la revisión pintada y pinta lo que responde la API', async () => {
    const { session, client, snapshot } = await opened({ world: { conversation: resourceOf({ revision: 7 }) } });
    client.sendInput.mockResolvedValue(ok(advanceOf({ revision: 8, pendingInput: textInputEvent('p', 2, 'required') }, [messageEvent('p', 'Otra vez'), textInputEvent('p', 2, 'required')])));
    await session.send({ text: '   ' }, '   ');
    expect(client.sendInput).toHaveBeenCalledTimes(1);
    expect(client.sendInput).toHaveBeenCalledWith(CONVERSATION_ID, { text: '   ' }, 7, expect.anything());
    expect(snapshot().conversation?.revision).toBe(8);
    expect(snapshot().pending).toMatchObject({ attempt: 2, reason: 'required' });
    await session.send({ text: 'Ana' }, 'Ana');
    expect(client.sendInput).toHaveBeenLastCalledWith(CONVERSATION_ID, { text: 'Ana' }, 8, expect.anything());
  });

  it('un segundo envío mientras hay uno en curso no hace nada (cerrojo del doble clic)', async () => {
    const { session, client } = await opened();
    client.sendInput.mockImplementation(() => new Promise(() => undefined));
    void session.send({ choice: 'a' }, 'A');
    void session.send({ choice: 'a' }, 'A');
    await session.send({ choice: 'a' }, 'A');
    expect(client.sendInput).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().timeline.filter((item) => item.kind === 'user')).toHaveLength(1);
  });

  it('no envía sin pregunta pendiente', async () => {
    const { session, client } = await opened({ world: { conversation: resourceOf({ status: 'ended', pendingInput: null }) } });
    await session.send({ text: 'Ana' }, 'Ana');
    expect(client.sendInput).not.toHaveBeenCalled();
  });
});

describe('fallos al enviar', () => {
  async function sendWith(result: ClientResult<AdvanceBody>, options: Parameters<typeof setup>[0] = {}) {
    const fixture = await opened(options);
    fixture.client.sendInput.mockResolvedValue(result);
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    return fixture;
  }

  it('412: relee, pinta lo de la otra pestaña, avisa y deja la respuesta como borrador sin reenviar', async () => {
    const fixture = await opened();
    fixture.client.sendInput.mockResolvedValue(fail('revision_mismatch', 412, 2));
    fixture.world.conversation = resourceOf({ revision: 2, pendingInput: textInputEvent('p', 2, 'required') });
    fixture.world.items = [flowItem(1, messageEvent('p', '¿Nombre?')), userItem(2, { text: '   ' }), flowItem(3, textInputEvent('p', 2, 'required'))];
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    const snapshot = fixture.snapshot();
    expect(snapshot.notice).toEqual({ kind: 'other_tab', text: 'La conversación ha avanzado en otra pestaña.', action: null });
    expect(texts(snapshot)).toEqual(['f:¿Nombre?', 'u:   ']);
    expect(snapshot.draft).toEqual({ text: 'Ana' });
    expect(snapshot.pending).toMatchObject({ attempt: 2 });
    expect(fixture.client.sendInput).toHaveBeenCalledTimes(1);
    expect(snapshot.sending).toBe(false);
  });

  it('409 conversation_busy: aviso con Volver a cargar, sin sondeos ni llamadas durante 10 s', async () => {
    vi.useFakeTimers();
    const fixture = await sendWith(fail('conversation_busy', 409));
    const calls = () => Object.values(fixture.client).reduce((sum, mock) => sum + mock.mock.calls.length, 0);
    const before = calls();
    expect(fixture.snapshot().notice).toEqual({ kind: 'busy', text: 'La conversación está procesando otra respuesta.', action: 'reload' });
    expect(texts(fixture.snapshot())).toEqual(['f:¿Nombre?']);
    expect(fixture.snapshot().draft).toEqual({ text: 'Ana' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls()).toBe(before);
    await fixture.session.reload();
    expect(fixture.client.getConversation).toHaveBeenCalledTimes(2);
    expect(fixture.snapshot().notice).toBeNull();
  });

  it.each(['conversation_not_active', 'conversation_expired'] as const)('%s: relee y muestra el fin según el estado leído', async (code) => {
    const fixture = await opened();
    fixture.client.sendInput.mockResolvedValue(fail(code, 409));
    fixture.world.conversation = resourceOf({ status: 'expired', pendingInput: null, revision: 1 });
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    expect(fixture.snapshot().conversation?.status).toBe('expired');
    expect(fixture.snapshot().pending).toBeNull();
    expect(fixture.snapshot().draft).toBeNull();
    expect(fixture.snapshot().notice).toBeNull();
  });

  it('invalid_input: aviso propio y relee', async () => {
    const fixture = await sendWith(fail('invalid_input', 400));
    expect(fixture.snapshot().notice).toEqual({ kind: 'send_error', text: 'La respuesta no tiene la forma que espera la pregunta.', action: null });
    expect(fixture.client.getConversation).toHaveBeenCalledTimes(2);
  });

  it('conversation_not_found: aviso de que ya no existe con enlace al inicio y sin pregunta', async () => {
    const fixture = await sendWith(fail('conversation_not_found', 404));
    expect(fixture.snapshot().notice).toEqual({ kind: 'gone', text: 'Esta conversación ya no existe.', action: 'home' });
    expect(fixture.snapshot().pending).toBeNull();
  });

  it.each([
    ['payload_too_large', 413, 'La respuesta es demasiado larga para enviarla.'],
    ['flow_version_invalid', 409, 'La versión publicada ya no es válida: publica una versión nueva.'],
    ['database_unavailable', 503, 'La base de datos de Franca no está disponible.'],
    ['unknown', 500, 'No se ha podido enviar la respuesta.'],
    ['internal_error', 500, 'No se ha podido enviar la respuesta.'],
  ] as const)('%s: aviso propio o genérico y la respuesta queda en su campo', async (code, status, text) => {
    const fixture = await sendWith(fail(code, status));
    expect(fixture.snapshot().notice).toEqual({ kind: 'send_error', text, action: null });
    expect(fixture.snapshot().draft).toEqual({ text: 'Ana' });
    expect(texts(fixture.snapshot())).toEqual(['f:¿Nombre?']);
    expect(fixture.snapshot().pending).not.toBeNull();
    expect(fixture.snapshot().sending).toBe(false);
  });

  it('respuesta perdida que sí se aplicó: relee y pinta lo aplicado, una sola vez, sin reenviar', async () => {
    const fixture = await opened();
    fixture.client.sendInput.mockResolvedValue(fail('network_error', null));
    fixture.world.conversation = resourceOf({ revision: 2, pendingInput: null, status: 'ended', outcome: 'ok' });
    fixture.world.items = [flowItem(1, messageEvent('p', '¿Nombre?')), userItem(2, { text: 'Ana' }), flowItem(3, messageEvent('fin', 'Adiós, .')), flowItem(4, { type: 'end', nodeId: 'fin', outcome: 'ok' })];
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    expect(fixture.client.sendInput).toHaveBeenCalledTimes(1);
    expect(texts(fixture.snapshot())).toEqual(['f:¿Nombre?', 'u:Ana', 'f:Adiós, .']);
    expect(fixture.snapshot().notice).toBeNull();
    expect(fixture.snapshot().draft).toBeNull();
  });

  it('respuesta perdida que no se aplicó: aviso con Reintentar, que reenvía el mismo input con el mismo If-Match; nunca se reenvía solo', async () => {
    const fixture = await opened({ world: { conversation: resourceOf({ revision: 4 }) } });
    fixture.client.sendInput.mockResolvedValue(fail('api_unreachable', 502));
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    expect(fixture.client.sendInput).toHaveBeenCalledTimes(1);
    expect(fixture.snapshot().notice).toEqual({ kind: 'lost_not_sent', text: 'No se ha podido enviar la respuesta.', action: 'retry' });
    expect(texts(fixture.snapshot())).toEqual(['f:¿Nombre?']);
    await settle();
    expect(fixture.client.sendInput).toHaveBeenCalledTimes(1);

    fixture.client.sendInput.mockResolvedValue(ok(advanceOf({ revision: 5, status: 'ended', pendingInput: null }, [messageEvent('fin', 'Adiós')])));
    await fixture.session.retry();
    expect(fixture.client.sendInput).toHaveBeenCalledTimes(2);
    expect(fixture.client.sendInput).toHaveBeenLastCalledWith(CONVERSATION_ID, { text: 'Ana' }, 4, expect.anything());
    expect(texts(fixture.snapshot())).toEqual(['f:¿Nombre?', 'u:Ana', 'f:Adiós']);
  });

  it('el reintento tras una respuesta perdida que sí se aplicó recibe el 412 y relee, sin aplicar dos veces', async () => {
    const fixture = await opened({ world: { conversation: resourceOf({ revision: 4 }) } });
    fixture.client.sendInput.mockResolvedValue(fail('network_error', null));
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    fixture.client.sendInput.mockResolvedValue(fail('revision_mismatch', 412, 5));
    fixture.world.conversation = resourceOf({ revision: 5 });
    await fixture.session.retry();
    expect(fixture.client.sendInput).toHaveBeenLastCalledWith(CONVERSATION_ID, { text: 'Ana' }, 4, expect.anything());
    expect(fixture.snapshot().notice?.kind).toBe('other_tab');
    expect(fixture.client.sendInput).toHaveBeenCalledTimes(2);
  });

  it('respuesta perdida y la relectura también falla: aviso de conexión con Volver a cargar, sin reenviar', async () => {
    const fixture = await opened();
    fixture.client.sendInput.mockResolvedValue(fail('network_error', null));
    fixture.client.getConversation.mockResolvedValue(fail('network_error', null));
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    expect(fixture.snapshot().notice).toEqual({ kind: 'load_failed', text: 'No se puede conectar con la API de Franca.', action: 'reload' });
    expect(fixture.client.sendInput).toHaveBeenCalledTimes(1);
    await fixture.session.retry();
    expect(fixture.client.sendInput).toHaveBeenCalledTimes(1);
  });

  it('el borrador se recupera en la pregunta siguiente: Ana sigue disponible tras un 412 con attempt 2', async () => {
    const fixture = await opened();
    fixture.client.sendInput.mockResolvedValue(fail('revision_mismatch', 412, 2));
    fixture.world.conversation = resourceOf({ revision: 2, pendingInput: textInputEvent('p', 2, 'required') });
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    expect(fixture.snapshot().draft).toEqual({ text: 'Ana' });
    expect(fixture.snapshot().pending).toMatchObject({ attempt: 2, reason: 'required' });
  });

  it('un envío correcto limpia el borrador', async () => {
    const fixture = await opened();
    fixture.client.sendInput.mockResolvedValueOnce(fail('payload_too_large', 413));
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    expect(fixture.snapshot().draft).toEqual({ text: 'Ana' });
    fixture.client.sendInput.mockResolvedValueOnce(ok(advanceOf({ revision: 2, status: 'ended', pendingInput: null }, [])));
    await fixture.session.send({ text: 'Ana' }, 'Ana');
    expect(fixture.snapshot().draft).toBeNull();
  });
});

describe('reanudación (StrictMode y Activity)', () => {
  const first = advanceOf({ revision: 1 }, [messageEvent('a', 'Uno', 600), messageEvent('b', 'Dos', 0), textInputEvent('p')]);

  it('el montaje doble antes de pintar nada reproduce el primer avance desde el principio, una sola vez', async () => {
    const fixture = setup({ initial: first });
    const stop = fixture.session.activate();
    stop();
    fixture.session.activate();
    await settle();
    expect(texts(fixture.snapshot())).toEqual(['f:Uno', 'f:Dos']);
    expect(fixture.client.getConversation).not.toHaveBeenCalled();
    expect(fixture.snapshot().pending).not.toBeNull();
  });

  it('ocultar la pantalla vuelve a loading, y mostrarla con algo ya pintado relee de la API', async () => {
    const fixture = setup({ initial: first });
    const stop = fixture.session.activate();
    await settle();
    expect(texts(fixture.snapshot())).toEqual(['f:Uno', 'f:Dos']);
    stop();
    expect(fixture.snapshot().phase).toBe('loading');
    expect(fixture.snapshot().timeline).toEqual([]);
    fixture.world.items = [flowItem(1, messageEvent('a', 'Uno')), flowItem(2, messageEvent('b', 'Dos')), flowItem(3, textInputEvent('p'))];
    fixture.session.activate();
    await settle();
    expect(fixture.client.getConversation).toHaveBeenCalledTimes(1);
    expect(texts(fixture.snapshot())).toEqual(['f:Uno', 'f:Dos']);
  });

  it('ocultar durante la reproducción, antes del primer mensaje, la reinicia al mostrarse y no duplica mensajes', async () => {
    vi.useFakeTimers();
    const fixture = setup({ initial: first });
    const real = new ConversationSession(CONVERSATION_ID, { client: fixture.client, navigate: fixture.navigate, initial: { conversationId: CONVERSATION_ID, conversation: first.conversation, events: first.events }, autoAcknowledge: true, sleep: defaultSleep });
    const stop = real.activate();
    await vi.advanceTimersByTimeAsync(300);
    expect(real.getSnapshot().timeline).toEqual([]);
    stop();
    real.activate();
    await vi.advanceTimersByTimeAsync(599);
    expect(real.getSnapshot().timeline).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(texts(real.getSnapshot())).toEqual(['f:Uno', 'f:Dos']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(texts(real.getSnapshot())).toEqual(['f:Uno', 'f:Dos']);
    expect(fixture.client.getConversation).not.toHaveBeenCalled();
  });

  it('el traspaso se lee sin consumirse hasta que se borra', () => {
    expect(peekFirstAdvance(CONVERSATION_ID)).toBeNull();
  });
});

describe('borrar', () => {
  it('el 204 navega al inicio', async () => {
    const { session, client, navigate } = await opened();
    await session.remove();
    expect(client.deleteConversation).toHaveBeenCalledWith(CONVERSATION_ID, expect.anything());
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('el 404 conversation_not_found navega al inicio también', async () => {
    const { session, client, navigate } = await opened();
    client.deleteConversation.mockResolvedValue(fail('conversation_not_found', 404));
    await session.remove();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('un error de conexión se queda con su aviso y no reintenta solo', async () => {
    vi.useFakeTimers();
    const { session, client, navigate, snapshot } = await opened();
    client.deleteConversation.mockResolvedValue(fail('network_error', null));
    await session.remove();
    expect(navigate).not.toHaveBeenCalled();
    expect(snapshot().notice).toEqual({ kind: 'remove_error', text: 'No se puede conectar con la API de Franca.', action: null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.deleteConversation).toHaveBeenCalledTimes(1);
  });

  it('un error sin cuerpo (unknown) se queda con el aviso genérico', async () => {
    const { session, client, navigate, snapshot } = await opened();
    client.deleteConversation.mockResolvedValue(fail('unknown', 403));
    await session.remove();
    expect(navigate).not.toHaveBeenCalled();
    expect(snapshot().notice).toEqual({ kind: 'remove_error', text: 'No se ha podido borrar la conversación.', action: null });
    expect(client.deleteConversation).toHaveBeenCalledTimes(1);
  });

  it('cancelar no llama a nada: la sesión no hace nada hasta que se pide borrar', async () => {
    const { client, navigate } = await opened();
    expect(client.deleteConversation).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('empezar de nuevo', () => {
  it('crea otra conversación del mismo flujo y contacto, guarda el traspaso y navega', async () => {
    const fixture = await opened({ world: { conversation: resourceOf({ contactId: 'c-1' }) } });
    const created = advanceOf({ id: '00000000-0000-4000-8000-000000000001', version: 2, contactId: 'c-1' }, [messageEvent('p', '¿Cómo te llamas?')]);
    fixture.client.createConversation.mockResolvedValue(ok(created, 201));
    await fixture.session.restart();
    expect(fixture.client.createConversation).toHaveBeenCalledWith('pregunta', 'c-1');
    expect(fixture.navigate).toHaveBeenCalledWith('/conversaciones/00000000-0000-4000-8000-000000000001');
    expect(peekFirstAdvance('00000000-0000-4000-8000-000000000001')?.conversation.version).toBe(2);
  });

  it('sin contacto manda la cadena vacía (el cliente omite la clave)', async () => {
    const fixture = await opened();
    fixture.client.createConversation.mockResolvedValue(ok(advanceOf({ id: '00000000-0000-4000-8000-000000000002' }, []), 201));
    await fixture.session.restart();
    expect(fixture.client.createConversation).toHaveBeenCalledWith('pregunta', '');
  });

  it('si no se puede crear, lo dice como al empezar y no navega', async () => {
    const fixture = await opened();
    fixture.client.createConversation.mockResolvedValue(fail('flow_not_found', 404));
    await fixture.session.restart();
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(fixture.snapshot().notice).toEqual({ kind: 'start_error', text: 'Ese flujo ya no existe.', action: null });
    expect(fixture.snapshot().starting).toBe(false);
  });
});
