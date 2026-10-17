import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { continueSession, startSession, type AdvanceResult, type EngineEvent, type EngineHost, type JsonValue, type LlmCapability, type SessionResult, type SessionState } from '@franca/engine';
import type { Flow } from '@franca/spec';
import { CLOCK, type Clock } from '../flows/clock.js';
import { HTTP_HOST } from '../http-host/http-host.module.js';
import type { HttpHost } from '../http-host/http-host.js';
import { toPage, type Page } from '../flows/flow-resources.js';
import { parseFlowId } from '../flows/flow-params.js';
import { etagOf, matchesIfMatch } from '../flows/if-match.js';
import { parseListQuery } from '../flows/list-query.js';
import { ApiException } from '../http/api-error.js';
import { createAdvanceLlm, type AdvanceLlm } from './advance-llm.js';
import { buildAdvanceWrite } from './advance-write.js';
import { initialContactView, type ContactView } from './contact-values.js';
import { parseCreateBody, parseInputBody } from './conversation-body.js';
import { parseConversationId, parseContactId } from './conversation-params.js';
import { parseConversationListQuery } from './conversation-query.js';
import { toConversationResource, toConversationSummary, toTranscriptItem, type ConversationResource, type ConversationSummary, type TranscriptItem } from './conversation-resources.js';
import { hasExpired, isClaimActive, LLM_WINDOW_MS } from './conversation-timing.js';
import { CONVERSATIONS_CONFIG, type ConversationsConfig } from './conversations-config.js';
import { ConversationsRepository, type LockedRow } from './conversations.repository.js';
import { buildEngineHost } from './engine-host.js';
import { LLM_PROVIDERS } from './llm-providers.js';

/** Lo que responden crear una conversación y enviarle una entrada: el recurso tras el avance y los eventos del motor. */
export interface AdvanceResponse {
  conversation: ConversationResource;
  events: EngineEvent[];
}

/** La reclamación tomada al empezar el avance de una entrada. */
interface Claim {
  row: LockedRow;
  token: string;
  definition: string;
}

/** Una versión ya aceptada por el motor y lo que gastó el avance que la ejecutó. */
interface Run {
  result: SessionResult;
  flow: Flow;
  advance: AdvanceLlm;
}

/** Códigos con los que el motor rechaza lo que la API guardó: son un fallo del servidor, no de la petición. */
const STORED_REJECTIONS: ReadonlySet<string> = new Set(['invalid_state', 'state_mismatch', 'session_not_active', 'invalid_contact']);

/** 412 con la revisión actual y su `ETag`, con el mensaje de la conversación (el código es el de los flujos). */
function revisionMismatch(revision: number): ApiException {
  return new ApiException('revision_mismatch', { message: 'la conversación ha cambiado', currentRevision: revision }, { ETag: etagOf(revision) });
}

/**
 * Casos de uso de las conversaciones, en el orden de comprobación de la spec. El motor corre siempre **fuera de toda
 * transacción**: se reclama la conversación (transacción de milisegundos), se ejecuta el motor sin conexión retenida y se
 * aplica el resultado (otra transacción corta). Cada paso toma un único `now` del reloj.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger('Conversations');

  constructor(
    private readonly repository: ConversationsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONVERSATIONS_CONFIG) private readonly config: ConversationsConfig,
    @Inject(LLM_PROVIDERS) private readonly providers: ReadonlyMap<string, LlmCapability>,
    @Inject(HTTP_HOST) private readonly http: HttpHost,
  ) {}

  /**
   * Crea una conversación y ejecuta el motor hasta su primera parada.
   *
   * @param body El valor que dio `JSON.parse` del cuerpo.
   * @returns El recurso y los eventos del primer avance.
   * @throws {ApiException} `invalid_request`, `flow_not_found`, `flow_not_published`, `version_not_found`,
   * `flow_version_invalid`, `conversation_not_found` (el contacto se borró durante la creación) o 500.
   */
  async create(body: unknown): Promise<AdvanceResponse> {
    const { flowId, version: requested, contactId } = parseCreateBody(body);
    parseFlowId(flowId);
    const live = await this.repository.findLiveFlow(flowId);
    if (!live) throw new ApiException('flow_not_found');
    if (requested === null && live.latestVersion === null) throw new ApiException('flow_not_published');
    const version = requested ?? live.latestVersion!;
    const definition = await this.repository.findVersionDefinition(flowId, version);
    if (definition === null) throw new ApiException('version_not_found');

    const id = randomUUID();
    const stored = new Map<string, JsonValue>();
    let contactEpoch: string | null = null;
    if (contactId !== null) {
      contactEpoch = await this.repository.ensureContact(contactId, randomUUID());
      for (const [name, value] of await this.repository.readContactValues(contactId)) stored.set(name, value);
    }
    const flow: unknown = JSON.parse(definition);
    const { advance, host } = this.newAdvance(id, 0);
    const result = await startSession({ flow, contact: Object.fromEntries(stored) }, host);
    const run = this.accepted(id, flow as Flow, result, advance);

    const now = this.clock.now();
    const write = buildAdvanceWrite({
      result: run.result,
      flow: run.flow,
      input: undefined,
      prior: { costUsd: 0, costLimitReached: false },
      advance,
      contactBefore: contactId === null ? null : initialContactView(run.flow, stored),
      now,
    });
    const inserted = await this.repository.insertConversation({ id, flowId, version, contactId, contactEpoch, now, write });
    if (inserted.kind === 'contact_gone') throw new ApiException('conversation_not_found');
    if (inserted.kind === 'flow_gone') throw new ApiException('flow_not_found');
    this.warnIfNotConfigured(id, run);
    return { conversation: toConversationResource(inserted.row, now), events: run.result.events };
  }

  /**
   * Envía la entrada del usuario y continúa la conversación.
   *
   * @param conversationId `:conversationId` de la ruta.
   * @param body El valor que dio `JSON.parse` del cuerpo.
   * @param ifMatch Cabecera `If-Match`, opcional.
   * @returns El recurso y los eventos del avance.
   * @throws {ApiException} `invalid_request`, `conversation_not_found`, `revision_mismatch`, `conversation_expired`,
   * `conversation_not_active`, `conversation_busy`, `flow_version_invalid`, `invalid_input` o 500.
   */
  async sendInput(conversationId: string, body: unknown, ifMatch: string | undefined): Promise<AdvanceResponse> {
    const { input } = parseInputBody(body);
    const id = parseConversationId(conversationId);
    const claim = await this.claim(id, ifMatch);
    let run: Run;
    try {
      run = await this.runEngine(id, claim, input);
    } catch (error) {
      // Un rechazo o un fallo antes de aplicar no cambia nada: la conversación queda libre para la entrada siguiente.
      await this.release(id, claim.token);
      throw error;
    }
    return this.apply(id, claim, run, input);
  }

  /** @throws {ApiException} `conversation_not_found`. */
  async get(conversationId: string): Promise<ConversationResource> {
    const row = await this.repository.findConversation(parseConversationId(conversationId));
    if (!row) throw new ApiException('conversation_not_found');
    return toConversationResource(row, this.clock.now());
  }

  /** Página de conversaciones (sin `pendingInput`) con el total. @throws {ApiException} `invalid_query`. */
  async list(query: Record<string, unknown>): Promise<Page<ConversationSummary>> {
    const parsed = parseConversationListQuery(query);
    const now = this.clock.now();
    const { items, total } = await this.repository.listConversations({ flowId: parsed.flowId, status: parsed.status }, parsed, now);
    return toPage(
      items.map((row) => toConversationSummary(row, now)),
      total,
      parsed.limit,
      parsed.offset,
    );
  }

  /** Página de la transcripción. La consulta se valida antes que el `id`. @throws {ApiException} `invalid_query` o `conversation_not_found`. */
  async transcript(conversationId: string, query: Record<string, unknown>): Promise<Page<TranscriptItem>> {
    const { limit, offset } = parseListQuery({ limit: query.limit, offset: query.offset });
    const page = await this.repository.listEntries(parseConversationId(conversationId), { limit, offset });
    if (!page) throw new ApiException('conversation_not_found');
    return toPage(page.items.map(toTranscriptItem), page.total, limit, offset);
  }

  /** Borra la conversación, su estado y su transcripción; gana a un avance en curso. @throws {ApiException} `conversation_not_found`. */
  async remove(conversationId: string): Promise<void> {
    if (!(await this.repository.deleteConversation(parseConversationId(conversationId)))) throw new ApiException('conversation_not_found');
  }

  /** Borra un contacto: sus valores, sus conversaciones y sus transcripciones. Existan o no. @throws {ApiException} `invalid_request`. */
  async removeContact(contactId: string): Promise<void> {
    await this.repository.deleteContact(parseContactId(contactId));
  }

  // ---- Pasos de un avance ----

  /** Reclama la conversación en una transacción corta: 404, 412, 409 (caducada o terminada), 409 (ocupada). */
  private async claim(id: string, ifMatch: string | undefined): Promise<Claim> {
    return this.repository.withLockedConversation(
      id,
      async (locked) => {
        if (!locked) throw new ApiException('conversation_not_found');
        const { row } = locked;
        const now = this.clock.now();
        if (ifMatch !== undefined && !matchesIfMatch(ifMatch, row.revision)) throw revisionMismatch(row.revision);
        if (row.status !== 'waiting') throw new ApiException('conversation_not_active');
        if (hasExpired(row.expiresAt, now)) throw new ApiException('conversation_expired');
        if (isClaimActive(row.claimToken, row.claimedAt, now)) throw new ApiException('conversation_busy');
        const token = randomUUID();
        await locked.claim(token, now);
        return { row, token, definition: await locked.readDefinition() };
      },
      { step: 'claim' },
    );
  }

  /** Ejecuta el motor con el estado guardado, sin transacción ni conexión abierta. */
  private async runEngine(id: string, claim: Claim, input: unknown): Promise<Run> {
    const { row } = claim;
    let state: unknown;
    try {
      state = row.state === null ? undefined : JSON.parse(row.state);
    } catch {
      // Un estado que no es JSON cuenta como `invalid_state`.
      state = undefined;
    }
    const flow: unknown = JSON.parse(claim.definition);
    const { advance, host } = this.newAdvance(id, row.costUsd);
    const result = await continueSession({ flow, state, input }, host);
    return this.accepted(id, flow as Flow, result, advance);
  }

  /** Aplica el resultado en una transacción corta: descarta todo si la conversación se borró o la reclamación se perdió. */
  private async apply(id: string, claim: Claim, run: Run, input: unknown): Promise<AdvanceResponse> {
    const { row } = claim;
    const response = await this.repository.withLockedConversation(
      id,
      async (locked) => {
        if (!locked) throw new ApiException('conversation_not_found');
        const now = this.clock.now();
        if (locked.row.claimToken !== claim.token || !isClaimActive(locked.row.claimToken, locked.row.claimedAt, now)) {
          throw new ApiException('conversation_busy');
        }
        const before = row.contactId === null ? null : (JSON.parse(row.state!) as SessionState).contact;
        const write = buildAdvanceWrite({
          result: run.result,
          flow: run.flow,
          input: { value: input },
          prior: { costUsd: row.costUsd, costLimitReached: row.costLimitReached },
          advance: run.advance,
          contactBefore: before as ContactView | null,
          now,
        });
        const updated = await locked.apply(write, now);
        return { conversation: toConversationResource(updated, now), events: run.result.events };
      },
      { step: 'apply', contactId: row.contactId },
    );
    this.warnIfNotConfigured(id, run);
    return response;
  }

  // ---- Piezas ----

  /**
   * El avance y el host del motor. `llm` y `http` comparten **un** inicio de plazo (`startedAtMs`): los 90 s de
   * `LLM_WINDOW_MS` valen para los turnos y para los intentos.
   */
  private newAdvance(id: string, priorCostUsd: number): { advance: AdvanceLlm; host: EngineHost } {
    const now = () => this.clock.now().getTime();
    const startedAtMs = now();
    const advance = createAdvanceLlm({ providers: this.providers, now, startedAtMs, budgetUsd: this.config.costLimitUsd, priorCostUsd });
    const http = this.http.forAdvance({ conversationId: id, deadlineMs: startedAtMs + LLM_WINDOW_MS, now });
    return { advance, host: buildEngineHost(advance.capability, http) };
  }

  /** El resultado del motor si lo aceptó; si no, el error del contrato (y el registro de un rechazo de lo guardado). */
  private accepted(id: string, flow: Flow, result: AdvanceResult, advance: AdvanceLlm): Run {
    if (result.ok) return { result, flow, advance };
    if (result.code === 'invalid_flow') throw new ApiException('flow_version_invalid', { issues: result.issues });
    if (result.code === 'invalid_input') throw new ApiException('invalid_input');
    if (STORED_REJECTIONS.has(result.code)) this.logger.error(`conversación ${id}: el motor rechazó lo guardado (${result.code})`);
    throw new ApiException('internal_error');
  }

  /** Libera la reclamación propia; si no se puede, caduca sola y gana el error original. */
  private async release(id: string, token: string): Promise<void> {
    try {
      await this.repository.releaseClaim(id, token);
    } catch {
      // Se ignora a propósito.
    }
  }

  /** Aviso de operación: una conversación falló con `llm_not_configured`. Sin claves, textos ni valores. */
  private warnIfNotConfigured(id: string, run: Run): void {
    const { state } = run.result;
    if (run.result.status !== 'failed' || state.error?.code !== 'llm_not_configured') return;
    const node = run.flow.nodes.find((candidate) => candidate.id === state.error!.nodeId);
    const provider = node !== undefined && node.type === 'llm' ? node.provider : undefined;
    this.logger.warn(`conversación ${id}: llm_not_configured en el nodo ${state.error.nodeId}, proveedor ${JSON.stringify(provider)}`);
  }
}
