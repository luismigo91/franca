import type { FlowValidationResult } from '@franca/spec';
import type { ChatErrorCode } from '@/lib/chat/copy';
import type { Point } from '@/lib/editor/canvas-geometry';
import { EDITOR_COPY, editorErrorCopy } from '@/lib/editor/copy';
import { flowText } from '@/lib/editor/flow-text';
import { isRecord, type Change, type EditResult, type FlowDoc } from '@/lib/editor/json-edit';
import type { FlowResource, VersionResource } from '@/lib/editor/api-types';
import { displayPositions } from '@/lib/editor/layout';
import { checkPublishable, checkSavable, type GateReason } from '@/lib/editor/save-gate';
import { validateDraft } from '@/lib/editor/validate-draft';
import type { ClientResult } from '@/lib/web-client';

/** Lo que la sesión necesita del cliente del navegador del editor. */
export interface SessionClient {
  getFlow(flowId: string, signal?: AbortSignal): Promise<ClientResult<FlowResource>>;
  updateFlow(flowId: string, text: string, revision: number): Promise<ClientResult<FlowResource>>;
  publishFlow(flowId: string, revision: number): Promise<ClientResult<VersionResource>>;
  deleteFlow(flowId: string, revision: number): Promise<ClientResult<null>>;
}

/** Lo último guardado en la API. `text` es `flowText(flow)` de la última lectura o del último 200. */
export interface SavedState {
  text: string;
  flow: FlowDoc;
  revision: number;
  name: string;
  latestVersion: number | null;
  unpublishedChanges: boolean;
}

export type Selection = { kind: 'node'; id: string } | { kind: 'flow' } | null;

/** Aviso del editor. `actions` dice qué botones lleva. */
export interface EditorNotice {
  kind: 'blocked' | 'conflict' | 'changed_outside' | 'unconfirmed' | 'gone' | 'error';
  text: string;
  actions: ('reload' | 'saveOver')[];
  /** La `currentRevision` que dio el 412: con ella, «Guardar encima» (nunca `*`). */
  currentRevision?: number;
}

export interface EditorSnapshot {
  phase: 'loading' | 'not_found' | 'load_error' | 'ready';
  loadError: ChatErrorCode | null;
  saved: SavedState | null;
  /** La fuente de verdad: el valor JSON del flujo tal como lo devolvió la API, editado. */
  draft: FlowDoc | null;
  draftText: string;
  /** El texto del borrador difiere del último guardado (nunca por identidad de objetos). */
  dirty: boolean;
  verdict: FlowValidationResult | null;
  /** Posición con la que se pinta cada nodo: la suya o la del diseño automático. */
  positions: ReadonlyMap<string, Point>;
  selection: Selection;
  busy: null | 'saving' | 'publishing' | 'deleting' | 'reloading';
  notice: EditorNotice | null;
  /** Para la región de estado: `seq` cambia con cada anuncio, aunque el texto se repita. */
  announcement: { seq: number; text: string } | null;
}

export type SaveOutcome =
  | { status: 'saved'; revision: number }
  | { status: 'blocked'; reason: GateReason }
  | { status: 'conflict' }
  | { status: 'unconfirmed' }
  | { status: 'gone' }
  | { status: 'error' }
  | { status: 'busy' }
  | { status: 'ignored' };

export type PublishOutcome =
  | { status: 'published'; version: number; created: boolean }
  | { status: 'blocked'; reason: GateReason }
  | { status: 'changed_outside' }
  | { status: 'gone' }
  | { status: 'error' }
  | { status: 'busy' }
  | { status: 'ignored' };

export type DeleteOutcome = { status: 'deleted' } | { status: 'changed_outside' } | { status: 'error' } | { status: 'busy' } | { status: 'ignored' };
export type ReloadOutcome = { status: 'reloaded' } | { status: 'gone' } | { status: 'error' } | { status: 'busy' } | { status: 'ignored' };

const LOADING: EditorSnapshot = {
  phase: 'loading',
  loadError: null,
  saved: null,
  draft: null,
  draftText: '',
  dirty: false,
  verdict: null,
  positions: new Map(),
  selection: null,
  busy: null,
  notice: null,
  announcement: null,
};

const notice = (kind: EditorNotice['kind'], text: string, actions: EditorNotice['actions'] = [], currentRevision?: number): EditorNotice =>
  currentRevision === undefined ? { kind, text, actions } : { kind, text, actions, currentRevision };

function toSaved(resource: FlowResource): SavedState {
  return {
    text: flowText(resource.flow),
    flow: resource.flow,
    revision: resource.revision,
    name: resource.name,
    latestVersion: resource.latestVersion,
    unpublishedChanges: resource.unpublishedChanges,
  };
}

/** Todo lo que se deriva del borrador y del último guardado, calculado en la misma pila del cambio (D6). */
function derive(draft: FlowDoc, saved: SavedState): Pick<EditorSnapshot, 'draft' | 'draftText' | 'dirty' | 'verdict' | 'positions'> {
  const draftText = flowText(draft);
  return { draft, draftText, dirty: draftText !== saved.text, verdict: validateDraft(draft), positions: displayPositions(draft) };
}

/** Sin respuesta (fallo de red, API inalcanzable, respuesta inválida) o un 5xx: no consta si se guardó. */
function isLoss(result: { status: number | null }): boolean {
  return result.status === null || result.status >= 500;
}

function nodeExists(draft: FlowDoc, id: string): boolean {
  return Array.isArray(draft.nodes) && (draft.nodes as unknown[]).some((node) => isRecord(node) && node.id === id);
}

/**
 * Modelo de un flujo en edición (D4), sin React, con `subscribe`/`getSnapshot`. El borrador es el JSON recibido, editado
 * por funciones puras. Valida en cada cambio en la misma pila, guarda con `If-Match`, resuelve un guardado sin respuesta
 * releyendo (nunca reenviando) y no navega ni mueve el foco: devuelve el resultado y la pantalla decide.
 */
export class EditorSession {
  private state: EditorSnapshot = LOADING;
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private abort = new AbortController();
  private announcements = 0;

  constructor(
    readonly flowId: string,
    private readonly client: SessionClient,
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): EditorSnapshot => this.state;

  private patch(change: Partial<EditorSnapshot>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }

  private announce(text: string): Partial<EditorSnapshot> {
    this.announcements += 1;
    return { announcement: { seq: this.announcements, text } };
  }

  /** Anuncia un texto en la región de estado (copiado, rechazo del autosalto, número de problemas). */
  say(text: string): void {
    this.patch(this.announce(text));
  }

  /**
   * Lee el borrador de la API (al montarse y al volver a mostrarse). No escribe nada: las posiciones del diseño
   * automático no entran en el borrador hasta mover, añadir o conectar.
   */
  async open(): Promise<void> {
    this.abort.abort();
    this.abort = new AbortController();
    const epoch = this.epoch;
    this.state = { ...LOADING };
    for (const listener of [...this.listeners]) listener();
    const result = await this.client.getFlow(this.flowId, this.abort.signal);
    if (epoch !== this.epoch || this.abort.signal.aborted) return;
    if (!result.ok) {
      this.patch(result.code === 'flow_not_found' ? { phase: 'not_found' } : { phase: 'load_error', loadError: result.code });
      return;
    }
    this.install(result.body, 'ready');
  }

  /** Aborta lo que haya en curso, sube la época (una respuesta tardía se descarta) y suelta el borrador. */
  reset(): void {
    this.epoch += 1;
    this.abort.abort();
    this.state = LOADING;
    for (const listener of [...this.listeners]) listener();
  }

  /** Sustituye el guardado y el borrador por lo leído; conserva la selección si el nodo sigue existiendo. */
  private install(resource: FlowResource, phase: 'ready', extra: Partial<EditorSnapshot> = {}): void {
    const saved = toSaved(resource);
    const previous = this.state.selection;
    const selection = previous?.kind === 'node' && !nodeExists(resource.flow, previous.id) ? null : previous;
    this.patch({ phase, loadError: null, saved, ...derive(resource.flow, saved), selection, busy: null, notice: null, ...extra });
  }

  /**
   * Aplica una edición al borrador. Síncrona: valida en la misma pila. Un error de campo (un id ocupado, un JSON que no
   * es un objeto) no cambia nada.
   *
   * @param change La edición, una función pura `(borrador, guardado) → flujo`.
   */
  edit(change: Change): EditResult {
    const { draft, saved, phase } = this.state;
    if (phase !== 'ready' || draft === null || saved === null) return { ok: false, error: '' };
    const result = change(draft, saved.flow);
    if (!result.ok || result.flow === draft) return result;
    const selection = this.state.selection;
    const stale = selection?.kind === 'node' && !nodeExists(result.flow, selection.id);
    this.patch({ ...derive(result.flow, saved), selection: stale ? null : selection, notice: this.state.notice?.kind === 'blocked' ? null : this.state.notice });
    return result;
  }

  /** Selecciona un nodo, el panel del flujo o nada. */
  select(selection: Selection): void {
    this.patch({ selection });
  }

  /** Quita el aviso actual. */
  dismissNotice(): void {
    this.patch({ notice: null });
  }

  /** Las barreras locales de «Guardar» sobre la instantánea (con un borrador cargado). */
  private gate(): ReturnType<typeof checkSavable> {
    const { dirty, verdict, draftText } = this.state;
    return verdict === null ? { ok: false, reason: 'invalid', message: '' } : checkSavable({ dirty, verdict, draftText });
  }

  private ready(): { draft: FlowDoc; saved: SavedState } | null {
    const { draft, saved, phase, busy } = this.state;
    return phase === 'ready' && draft !== null && saved !== null && busy === null ? { draft, saved } : null;
  }

  /** «Guardar»: las barreras locales, el `PUT` con `If-Match` de la revisión y el resultado. */
  async save(): Promise<SaveOutcome> {
    const current = this.ready();
    if (current === null) return { status: 'busy' };
    const gate = this.gate();
    if (!gate.ok) {
      this.patch({ notice: notice('blocked', gate.message) });
      return { status: 'blocked', reason: gate.reason };
    }
    return this.send(this.state.draftText, current.saved.revision);
  }

  /** «Guardar encima» tras un 412: repite el `PUT` con el texto actual y la `currentRevision` recibida, nunca con `*`. */
  async saveOver(): Promise<SaveOutcome> {
    const currentRevision = this.state.notice?.currentRevision;
    if (this.ready() === null || currentRevision === undefined) return { status: 'busy' };
    const gate = this.gate();
    if (!gate.ok) {
      this.patch({ notice: notice('blocked', gate.message) });
      return { status: 'blocked', reason: gate.reason };
    }
    return this.send(this.state.draftText, currentRevision);
  }

  private async send(sent: string, revision: number): Promise<SaveOutcome> {
    const epoch = this.epoch;
    this.patch({ busy: 'saving', notice: null });
    const result = await this.client.updateFlow(this.flowId, sent, revision);
    if (epoch !== this.epoch) return { status: 'ignored' };
    if (result.ok) return this.finishSave(result.body);
    if (result.code === 'revision_mismatch' && result.status === 412) {
      const reached = result.currentRevision;
      this.patch({ busy: null, notice: notice('conflict', EDITOR_COPY.conflict, reached === undefined ? ['reload'] : ['reload', 'saveOver'], reached) });
      return { status: 'conflict' };
    }
    if (isLoss(result)) return this.recover(sent, result.code, epoch);
    if (result.code === 'flow_not_found') {
      this.patch({ busy: null, notice: notice('gone', EDITOR_COPY.gone) });
      return { status: 'gone' };
    }
    this.patch({ busy: null, notice: notice('error', editorErrorCopy('save', result.code)) });
    return { status: 'error' };
  }

  /** Guardado dado por hecho: lo enviado pasa a ser lo guardado y lo escrito mientras tanto sigue como cambio. */
  private finishSave(resource: FlowResource): SaveOutcome {
    const saved = toSaved(resource);
    const draft = this.state.draft ?? resource.flow;
    this.patch({ saved, ...derive(draft, saved), busy: null, notice: null, ...this.announce(EDITOR_COPY.saved(resource.revision)) });
    return { status: 'saved', revision: resource.revision };
  }

  /** Sin respuesta: releer antes de nada. Si el texto leído es el enviado, se da por guardado. Nunca se reenvía. */
  private async recover(sent: string, code: ChatErrorCode, epoch: number): Promise<SaveOutcome> {
    const reread = await this.client.getFlow(this.flowId);
    if (epoch !== this.epoch) return { status: 'ignored' };
    if (reread.ok && flowText(reread.body.flow) === sent) return this.finishSave(reread.body);
    const text = code === 'database_unavailable' ? EDITOR_COPY.unconfirmedDatabase : EDITOR_COPY.unconfirmed;
    this.patch({ busy: null, notice: notice('unconfirmed', text) });
    return { status: 'unconfirmed' };
  }

  /** «Publicar»: solo sin cambios sin guardar; `POST …/versions` con `If-Match` de la revisión guardada. */
  async publish(): Promise<PublishOutcome> {
    const current = this.ready();
    if (current === null) return { status: 'busy' };
    const gate = checkPublishable(this.state);
    if (!gate.ok) {
      this.patch({ notice: notice('blocked', gate.message) });
      return { status: 'blocked', reason: gate.reason };
    }
    const epoch = this.epoch;
    this.patch({ busy: 'publishing', notice: null });
    const result = await this.client.publishFlow(this.flowId, current.saved.revision);
    if (epoch !== this.epoch) return { status: 'ignored' };
    if (result.ok) {
      const version = result.body.version;
      const created = result.status === 201;
      const saved = { ...current.saved, latestVersion: version, unpublishedChanges: false };
      this.patch({ saved, busy: null, ...derive(this.state.draft ?? current.draft, saved), ...this.announce(created ? EDITOR_COPY.published(version) : EDITOR_COPY.alreadyPublished(version)) });
      return { status: 'published', version, created };
    }
    if (result.code === 'revision_mismatch') {
      this.patch({ busy: null, notice: notice('changed_outside', EDITOR_COPY.changedOutside, ['reload']) });
      return { status: 'changed_outside' };
    }
    if (result.code === 'flow_not_found') {
      this.patch({ busy: null, notice: notice('gone', EDITOR_COPY.gone) });
      return { status: 'gone' };
    }
    this.patch({ busy: null, notice: notice('error', editorErrorCopy('publish', result.code)) });
    return { status: 'error' };
  }

  /** «Borrar flujo» (ya confirmado): `DELETE` con `If-Match`. Un 404 también deja salir (ya no existe). */
  async remove(): Promise<DeleteOutcome> {
    const current = this.ready();
    if (current === null) return { status: 'busy' };
    const epoch = this.epoch;
    this.patch({ busy: 'deleting', notice: null });
    const result = await this.client.deleteFlow(this.flowId, current.saved.revision);
    if (epoch !== this.epoch) return { status: 'ignored' };
    if (result.ok || result.code === 'flow_not_found') {
      this.patch({ busy: null });
      return { status: 'deleted' };
    }
    if (result.code === 'revision_mismatch') {
      this.patch({ busy: null, notice: notice('changed_outside', EDITOR_COPY.changedOutside, ['reload']) });
      return { status: 'changed_outside' };
    }
    this.patch({ busy: null, notice: notice('error', editorErrorCopy('delete', result.code)) });
    return { status: 'error' };
  }

  /** «Descartar cambios» y «Cargar el guardado»: vuelve a leer el borrador y sustituye guardado y borrador. */
  async reloadSaved(): Promise<ReloadOutcome> {
    if (this.state.phase !== 'ready' || this.state.busy !== null) return { status: 'busy' };
    const epoch = this.epoch;
    this.patch({ busy: 'reloading' });
    const result = await this.client.getFlow(this.flowId);
    if (epoch !== this.epoch) return { status: 'ignored' };
    if (result.ok) {
      this.install(result.body, 'ready');
      return { status: 'reloaded' };
    }
    if (result.code === 'flow_not_found') {
      this.patch({ busy: null, notice: notice('gone', EDITOR_COPY.gone) });
      return { status: 'gone' };
    }
    this.patch({ busy: null, notice: notice('error', editorErrorCopy('open', result.code)) });
    return { status: 'error' };
  }
}
