import type { UserInput } from '@franca/engine';
import { WEB_PAGES } from '@/config/endpoints';
import type { ConversationResource, TranscriptItem } from '@/lib/chat/api-types';
import { COPY, errorCopy, type ChatErrorCode } from '@/lib/chat/copy';
import { readEvents, type ChatEvent, type PendingQuestion } from '@/lib/chat/events';
import { startConversation, type FirstAdvance } from '@/lib/chat/first-advance';
import {
  buildTranscriptView,
  pendingFromResource,
  readFullTranscript,
  type ActivityItem,
  type TimelineItem,
} from '@/lib/chat/transcript-view';
import type { ClientResult, WebClient } from '@/lib/web-client';

/** Lo que la sesión necesita del cliente del navegador. */
export type SessionClient = Pick<
  WebClient,
  'getConversation' | 'getTranscriptPage' | 'getFlowVersion' | 'sendInput' | 'deleteConversation' | 'createConversation'
>;

export interface SessionDeps {
  client: SessionClient;
  /** Espera `ms` y resuelve también si se aborta la señal (nunca rechaza). */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Navegación del router. */
  navigate: (path: string) => void;
  /** Primer avance de una conversación recién creada, si venimos de «Probar». */
  initial?: FirstAdvance | null;
  /** Solo en tests: no espera a que la vista confirme cada mensaje. */
  autoAcknowledge?: boolean;
}

/** Aviso de la conversación. `action` dice qué botón lleva: releer, reintentar o volver al inicio. */
export interface Notice {
  kind: 'other_tab' | 'busy' | 'lost_not_sent' | 'send_error' | 'start_error' | 'remove_error' | 'gone' | 'load_failed';
  text: string;
  action: 'reload' | 'retry' | 'home' | null;
}

export interface ConversationSnapshot {
  phase: 'loading' | 'not_found' | 'load_error' | 'ready';
  loadError: ChatErrorCode | null;
  conversation: ConversationResource | null;
  /** `name` de la versión, o el `flowId` si el flujo se borró o no se pudo leer. */
  header: { title: string; version: number } | null;
  timeline: TimelineItem[];
  activity: ActivityItem[];
  /** Solo tras pintar el último mensaje y si la conversación espera. */
  pending: PendingQuestion | null;
  /** Indicador de «escribiendo». */
  typing: boolean;
  sending: boolean;
  /** `false` mientras se reproduce un avance: ni pregunta ni aviso de fin. */
  settled: boolean;
  /** «Empezar de nuevo» en curso. */
  starting: boolean;
  notice: Notice | null;
  /** Respuesta no enviada que la pregunta siguiente recupera. */
  draft: UserInput | null;
}

const LOADING: ConversationSnapshot = {
  phase: 'loading',
  loadError: null,
  conversation: null,
  header: null,
  timeline: [],
  activity: [],
  pending: null,
  typing: false,
  sending: false,
  settled: false,
  starting: false,
  notice: null,
  draft: null,
};

const BUSY: Notice = { kind: 'busy', text: COPY.busy, action: 'reload' };

/** Espera de verdad `ms`; se resuelve también al abortar la señal. */
export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

type Read = { ok: true; conversation: ConversationResource; items: TranscriptItem[] } | { ok: false; code: ChatErrorCode };

/**
 * Modelo de una conversación en el cliente (D10): sin React, con `subscribe`/`getSnapshot`. Reproduce los avances con
 * su ritmo, envía con `If-Match` y resuelve cada fallo releyendo, nunca reenviando por su cuenta. No hay sondeos: lo
 * único que programa es la espera de la reproducción.
 */
export class ConversationSession {
  private state: ConversationSnapshot = LOADING;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private abort = new AbortController();
  private hasPainted = false;
  private counter = 0;
  private lost: { input: UserInput; label: string; revision: number } | null = null;
  private readonly acked = new Set<string>();
  private readonly waiters = new Map<string, () => void>();

  constructor(
    readonly conversationId: string,
    private readonly deps: SessionDeps,
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ConversationSnapshot => this.state;

  private patch(change: Partial<ConversationSnapshot>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }

  private nextKey(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  /**
   * Arranca la sesión (al montarse o al volver a mostrarse) y devuelve el *cleanup* (al desmontarse o al ocultarse).
   * Si venimos de «Probar» y todavía no se ha pintado nada, reproduce el primer avance desde el principio (también
   * tras el montaje doble de `StrictMode` o un `<Activity>` oculto antes del primer mensaje). Si ya se pintó algo,
   * relee de la API.
   */
  activate(): () => void {
    this.generation += 1;
    const generation = this.generation;
    this.abort = new AbortController();
    const initial = this.deps.initial;
    if (initial && !this.hasPainted) this.begin(initial, generation);
    else void this.load(generation);
    return () => this.deactivate();
  }

  private deactivate(): void {
    this.generation += 1;
    this.abort.abort();
    for (const release of this.waiters.values()) release();
    this.waiters.clear();
    this.acked.clear();
    this.lost = null;
    // El patrón de `<Activity>`: al ocultarse, el estado vuelve a `loading` y no se ve la lista vieja al volver.
    this.state = LOADING;
    for (const listener of [...this.listeners]) listener();
  }

  /** La vista confirma que el mensaje `key` ya está en el DOM: empieza la espera del siguiente. */
  acknowledge(key: string): void {
    this.acked.add(key);
    const release = this.waiters.get(key);
    if (release) {
      this.waiters.delete(key);
      release();
    }
  }

  private waitForAck(key: string): Promise<void> {
    if (this.deps.autoAcknowledge || this.acked.has(key)) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.set(key, resolve);
    });
  }

  // ---- primer avance y reproducción

  private begin(initial: FirstAdvance, generation: number): void {
    this.lost = null;
    this.state = {
      ...LOADING,
      phase: 'ready',
      conversation: initial.conversation,
      header: null,
    };
    for (const listener of [...this.listeners]) listener();
    void this.loadHeader(initial.conversation, generation);
    void this.play(readEvents(initial.events), initial.conversation, generation);
  }

  private async loadHeader(conversation: ConversationResource, generation: number): Promise<void> {
    const version = await this.deps.client.getFlowVersion(conversation.flowId, conversation.version, this.abort.signal);
    if (generation !== this.generation) return;
    const title = version.ok ? version.body.name : conversation.flowId;
    this.patch({ header: { title, version: conversation.version } });
  }

  /** Reproduce los eventos de un avance: cada `message` con su indicador y su espera, y la pregunta al final. */
  private async play(events: ChatEvent[], resource: ConversationResource, generation: number): Promise<void> {
    this.patch({ conversation: resource, settled: false, pending: null, notice: null });
    for (const event of events) {
      if (generation !== this.generation) return;
      if (event.type === 'message') {
        if (event.typingDelayMs > 0) {
          this.patch({ typing: true });
          await this.deps.sleep(event.typingDelayMs, this.abort.signal);
          if (generation !== this.generation) return;
        }
        const key = this.nextKey('f');
        this.hasPainted = true;
        this.patch({ timeline: [...this.state.timeline, { kind: 'flow', key, nodeId: event.nodeId, content: event.content }], typing: false });
        await this.waitForAck(key);
      } else if (event.type === 'http' || event.type === 'llm' || event.type === 'error') {
        this.patch({ activity: [...this.state.activity, event] });
      }
    }
    if (generation !== this.generation) return;
    this.hasPainted = true;
    this.patch({ typing: false, settled: true, pending: pendingFromResource(resource) });
  }

  // ---- lectura

  private async readAll(): Promise<Read> {
    const signal = this.abort.signal;
    const conversation = await this.deps.client.getConversation(this.conversationId, signal);
    if (!conversation.ok) return { ok: false, code: conversation.code };
    const transcript = await readFullTranscript((offset) => this.deps.client.getTranscriptPage(this.conversationId, offset, signal));
    if (!transcript.ok) return { ok: false, code: transcript.code };
    return { ok: true, conversation: conversation.body, items: transcript.body };
  }

  /** Pinta lo leído: la historia, la actividad, la pregunta del recurso y, si procesa, el aviso de ocupada. */
  private paint(read: Extract<Read, { ok: true }>): void {
    const view = buildTranscriptView(read.items);
    this.hasPainted = true;
    this.patch({
      phase: 'ready',
      loadError: null,
      conversation: read.conversation,
      timeline: view.timeline,
      activity: view.activity,
      pending: pendingFromResource(read.conversation),
      typing: false,
      sending: false,
      settled: true,
      notice: read.conversation.processing ? BUSY : null,
    });
  }

  /** Abre la conversación: el recurso, el nombre de la versión y la transcripción completa. */
  private async load(generation: number): Promise<void> {
    this.state = LOADING;
    for (const listener of [...this.listeners]) listener();
    const signal = this.abort.signal;
    const conversation = await this.deps.client.getConversation(this.conversationId, signal);
    if (generation !== this.generation) return;
    if (!conversation.ok) {
      if (conversation.code === 'conversation_not_found') this.patch({ phase: 'not_found' });
      else this.patch({ phase: 'load_error', loadError: conversation.code });
      return;
    }
    const resource = conversation.body;
    const [version, transcript] = await Promise.all([
      this.deps.client.getFlowVersion(resource.flowId, resource.version, signal),
      readFullTranscript((offset) => this.deps.client.getTranscriptPage(this.conversationId, offset, signal)),
    ]);
    if (generation !== this.generation) return;
    if (!transcript.ok) {
      this.patch({ phase: 'load_error', loadError: transcript.code });
      return;
    }
    this.patch({ header: { title: version.ok ? version.body.name : resource.flowId, version: resource.version } });
    this.paint({ ok: true, conversation: resource, items: transcript.body });
  }

  /** «Reintentar» tras un fallo al abrir. */
  retryLoad(): void {
    this.generation += 1;
    this.abort.abort();
    this.abort = new AbortController();
    void this.load(this.generation);
  }

  /** «Volver a cargar»: relee el recurso y la transcripción sin tocar la respuesta no enviada. */
  async reload(): Promise<void> {
    const generation = this.generation;
    this.patch({ notice: null });
    await this.reread(generation);
  }

  private async reread(generation: number): Promise<Read> {
    const read = await this.readAll();
    if (generation !== this.generation) return read;
    if (read.ok) this.paint(read);
    else this.patch({ typing: false, sending: false, notice: { kind: 'load_failed', text: errorCopy('open', read.code), action: 'reload' } });
    return read;
  }

  // ---- envío

  /**
   * Envía una respuesta con `If-Match: "<revisión pintada>"`. Si ya hay un envío en curso no hace nada: esa es la defensa
   * del doble clic, no el `disabled`.
   *
   * @param input La respuesta, tal como la manda el navegador.
   * @param label El texto con el que se pinta como mensaje del usuario.
   */
  async send(input: UserInput, label: string): Promise<void> {
    const { conversation, pending, settled, sending } = this.state;
    if (sending || !conversation || !pending || !settled || conversation.status !== 'waiting') return;
    await this.submit(input, label, conversation.revision);
  }

  /** «Reintentar» tras una respuesta perdida: el mismo `input` con el mismo `If-Match`. */
  async retry(): Promise<void> {
    const lost = this.lost;
    if (!lost || this.state.sending) return;
    await this.submit(lost.input, lost.label, lost.revision);
  }

  private async submit(input: UserInput, label: string, revision: number): Promise<void> {
    const generation = this.generation;
    const userKey = this.nextKey('u');
    this.lost = null;
    this.patch({
      timeline: [...this.state.timeline, { kind: 'user', key: userKey, text: label }],
      typing: true,
      sending: true,
      notice: null,
      draft: null,
    });
    const result = await this.deps.client.sendInput(this.conversationId, input, revision, this.abort.signal);
    if (generation !== this.generation) return;
    if (result.ok) {
      this.patch({ sending: false, draft: null });
      await this.play(readEvents(result.body.events), result.body.conversation, generation);
      return;
    }
    await this.fail(result, input, label, revision, userKey, generation);
  }

  private async fail(
    result: Extract<ClientResult<unknown>, { ok: false }>,
    input: UserInput,
    label: string,
    revision: number,
    userKey: string,
    generation: number,
  ): Promise<void> {
    // En todos los casos sin éxito el mensaje del usuario desaparece y la respuesta queda como borrador.
    this.patch({ timeline: this.state.timeline.filter((item) => item.key !== userKey), typing: false, sending: false, draft: input });
    const code = result.code;
    switch (code) {
      case 'network_error':
      case 'api_unreachable':
        await this.reconcileLost(input, label, revision, generation);
        return;
      case 'revision_mismatch': {
        const read = await this.reread(generation);
        if (generation === this.generation && read.ok) this.patch({ notice: { kind: 'other_tab', text: COPY.otherTab, action: null } });
        return;
      }
      case 'conversation_busy':
        this.patch({ notice: BUSY });
        return;
      case 'conversation_not_active':
      case 'conversation_expired':
        await this.reread(generation);
        if (generation === this.generation) this.patch({ draft: null });
        return;
      case 'invalid_input': {
        const read = await this.reread(generation);
        if (generation === this.generation && read.ok) this.patch({ notice: { kind: 'send_error', text: errorCopy('send', code), action: null } });
        return;
      }
      case 'conversation_not_found':
        this.patch({ pending: null, notice: { kind: 'gone', text: errorCopy('send', code), action: 'home' } });
        return;
      default:
        this.patch({ notice: { kind: 'send_error', text: errorCopy('send', code), action: null } });
    }
  }

  /** Respuesta perdida: relee. Si la revisión avanzó, pinta lo aplicado; si no, ofrece «Reintentar» (sin reenviar solo). */
  private async reconcileLost(input: UserInput, label: string, revision: number, generation: number): Promise<void> {
    const read = await this.readAll();
    if (generation !== this.generation) return;
    if (!read.ok) {
      this.patch({ notice: { kind: 'load_failed', text: errorCopy('open', read.code), action: 'reload' } });
      return;
    }
    this.paint(read);
    if (read.conversation.revision > revision) {
      this.patch({ draft: null });
      return;
    }
    this.lost = { input, label, revision };
    this.patch({ notice: { kind: 'lost_not_sent', text: COPY.lostNotSent, action: 'retry' } });
  }

  // ---- borrar y empezar de nuevo

  /** Borra la conversación (tras confirmar en el diálogo). 204 y 404 llevan al inicio; cualquier otro fallo se queda con su aviso. */
  async remove(): Promise<void> {
    const generation = this.generation;
    const result = await this.deps.client.deleteConversation(this.conversationId, this.abort.signal);
    if (generation !== this.generation) return;
    if (result.ok || result.code === 'conversation_not_found') {
      this.deps.navigate(WEB_PAGES.home);
      return;
    }
    this.patch({ notice: { kind: 'remove_error', text: errorCopy('remove', result.code), action: null } });
  }

  /** «Empezar de nuevo»: otra conversación del mismo flujo (última versión publicada) y el mismo contacto. */
  async restart(): Promise<void> {
    const conversation = this.state.conversation;
    if (!conversation || this.state.starting) return;
    const generation = this.generation;
    this.patch({ starting: true, notice: null });
    const result = await startConversation(this.deps.client, conversation.flowId, conversation.contactId ?? '', this.deps.navigate);
    if (generation !== this.generation) return;
    if (result.ok) {
      this.patch({ starting: false });
      return;
    }
    this.patch({ starting: false, notice: { kind: 'start_error', text: errorCopy('start', result.code), action: null } });
  }
}
