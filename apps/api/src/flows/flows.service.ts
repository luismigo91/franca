import { Inject, Injectable } from '@nestjs/common';
import { capWarnings, validateFlow, type FlowIssue, type FlowValidationResult, type FlowWarning } from '@franca/spec';
import { ApiException } from '../http/api-error.js';
import { CLOCK, type Clock } from './clock.js';
import { inspectFlowBody } from './flow-body.js';
import { parseFlowId, parseVersion } from './flow-params.js';
import {
  toFlowResource,
  toFlowSummary,
  toPage,
  toVersionResource,
  toVersionSummary,
  type FlowResource,
  type FlowSummary,
  type Page,
  type VersionResource,
  type VersionSummary,
} from './flow-resources.js';
import { FlowsRepository } from './flows.repository.js';
import { matchesIfMatch, etagOf } from './if-match.js';
import type { ListQuery } from './list-query.js';

export interface FlowValidationResponse {
  valid: boolean;
  issues: FlowIssue[];
  warnings: FlowWarning[];
}

/** Lo que responde una operación de escritura: el recurso y si creó algo nuevo (201) o devolvió lo que ya había (200). */
export interface Written<T> {
  resource: T;
  created: boolean;
}

/** `invalid_flow` con los `issues` y los `warnings` (recortados para mostrar) del veredicto. */
function invalidFlow(verdict: FlowValidationResult): ApiException {
  return new ApiException('invalid_flow', { issues: verdict.issues, warnings: capWarnings(verdict.warnings) });
}

/**
 * `literal_credential` si el veredicto, ya válido, tiene algún `credential_header_literal`. Decide con la lista
 * completa de avisos (no la recortada) y responde solo con esos: son la causa y no se pierden tras otros 100 avisos.
 */
function literalCredential(warnings: FlowWarning[]): ApiException | undefined {
  const literal = warnings.filter((warning) => warning.code === 'credential_header_literal');
  return literal.length ? new ApiException('literal_credential', { warnings: capWarnings(literal) }) : undefined;
}

/** 412 con la revisión actual y su `ETag`. */
function revisionMismatch(revision: number): ApiException {
  return new ApiException('revision_mismatch', { currentRevision: revision }, { ETag: etagOf(revision) });
}

/**
 * Casos de uso de los flujos, en el orden de comprobación de la spec. `inspectFlowBody` y el resto de lo que no
 * depende de la base se ejecutan fuera de la transacción; las escrituras de un flujo toman antes su bloqueo.
 */
@Injectable()
export class FlowsService {
  constructor(
    private readonly repository: FlowsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Valida un flujo sin guardarlo ni tocar la base de datos.
   *
   * @param flow El valor que dio `JSON.parse` del cuerpo.
   * @returns El veredicto sobre la forma JSON del cuerpo, con los avisos recortados para mostrar.
   */
  validate(flow: unknown): FlowValidationResponse {
    const { verdict } = inspectFlowBody(flow);
    return { valid: verdict.valid, issues: verdict.issues, warnings: capWarnings(verdict.warnings) };
  }

  /**
   * Crea un flujo.
   *
   * @throws {ApiException} `invalid_flow`, `literal_credential`, `flow_already_exists` o `flow_id_reserved`, en ese orden.
   */
  async create(body: unknown): Promise<FlowResource> {
    const { verdict, text } = inspectFlowBody(body);
    if (!verdict.valid) throw invalidFlow(verdict);
    const credential = literalCredential(verdict.warnings);
    if (credential) throw credential;
    const { flow } = verdict;
    const result = await this.repository.create({ id: flow.id, nameJson: JSON.stringify(flow.name), draft: text!, now: this.clock.now() });
    if (!result.ok) throw new ApiException(result.reserved ? 'flow_id_reserved' : 'flow_already_exists');
    return toFlowResource(result.row);
  }

  /** @throws {ApiException} `flow_not_found`. */
  async get(flowId: string): Promise<FlowResource> {
    const row = await this.repository.findActive(parseFlowId(flowId));
    if (!row) throw new ApiException('flow_not_found');
    return toFlowResource(row);
  }

  async list(query: ListQuery): Promise<Page<FlowSummary>> {
    const { items, total } = await this.repository.list({ published: query.published }, query);
    return toPage(items.map(toFlowSummary), total, query.limit, query.offset);
  }

  /**
   * Sustituye el borrador. Orden: `flow_not_found`, 428, 412, `invalid_flow`, `literal_credential`,
   * `flow_id_mismatch`; un texto idéntico al guardado no escribe nada.
   *
   * @param ifMatch Cabecera `If-Match`, obligatoria.
   */
  async update(flowId: string, ifMatch: string | undefined, body: unknown): Promise<FlowResource> {
    const id = parseFlowId(flowId);
    const { verdict, text } = inspectFlowBody(body);
    return this.repository.withLockedFlow(id, async (locked) => {
      if (!locked) throw new ApiException('flow_not_found');
      const { row } = locked;
      if (ifMatch === undefined) throw new ApiException('precondition_required');
      if (!matchesIfMatch(ifMatch, row.revision)) throw revisionMismatch(row.revision);
      if (!verdict.valid) throw invalidFlow(verdict);
      const credential = literalCredential(verdict.warnings);
      if (credential) throw credential;
      const { flow } = verdict;
      if (flow.id !== id) throw new ApiException('flow_id_mismatch');
      if (text === row.draft) return toFlowResource(row);
      const last = await locked.lastVersion();
      const updated = await locked.updateDraft({
        draft: text!,
        nameJson: JSON.stringify(flow.name),
        unpublishedChanges: last === null || text !== last.definition,
        now: this.clock.now(),
      });
      return toFlowResource(updated);
    });
  }

  /**
   * Publica el borrador. Orden: `flow_not_found`, 412 (si trae `If-Match`), `invalid_flow`, `literal_credential`;
   * con el mismo texto que la última versión devuelve esa (200) y si no crea la siguiente (201).
   */
  async publish(flowId: string, ifMatch: string | undefined): Promise<Written<VersionResource>> {
    return this.repository.withLockedFlow(parseFlowId(flowId), async (locked) => {
      if (!locked) throw new ApiException('flow_not_found');
      const { row } = locked;
      this.checkOptionalIfMatch(ifMatch, row.revision);
      // El validador vigente puede ser más estricto que el que guardó el borrador: toda versión fue válida al publicarse.
      const verdict = validateFlow(JSON.parse(row.draft));
      if (!verdict.valid) throw invalidFlow(verdict);
      const credential = literalCredential(verdict.warnings);
      if (credential) throw credential;
      const last = await locked.lastVersion();
      if (last && last.definition === row.draft) return { resource: toVersionResource(last), created: false };
      const created = await locked.insertVersion({ nameJson: row.nameJson, definition: row.draft, now: this.clock.now() });
      return { resource: toVersionResource(created), created: true };
    });
  }

  /** Borrado lógico. @throws {ApiException} `flow_not_found` o 412 (si trae `If-Match`). */
  async remove(flowId: string, ifMatch: string | undefined): Promise<void> {
    await this.repository.withLockedFlow(parseFlowId(flowId), async (locked) => {
      if (!locked) throw new ApiException('flow_not_found');
      this.checkOptionalIfMatch(ifMatch, locked.row.revision);
      await locked.markDeleted(this.clock.now());
    });
  }

  /** @throws {ApiException} `flow_not_found`. */
  async listVersions(flowId: string, query: ListQuery): Promise<Page<VersionSummary>> {
    const id = parseFlowId(flowId);
    if (!(await this.repository.findActive(id))) throw new ApiException('flow_not_found');
    const { items, total } = await this.repository.listVersions(id, query);
    return toPage(items.map(toVersionSummary), total, query.limit, query.offset);
  }

  /** @throws {ApiException} `flow_not_found` o `version_not_found`. */
  async getVersion(flowId: string, version: string): Promise<VersionResource> {
    const id = parseFlowId(flowId);
    if (!(await this.repository.findActive(id))) throw new ApiException('flow_not_found');
    const number = parseVersion(version);
    const row = number === undefined ? null : await this.repository.findVersion(id, number);
    if (!row) throw new ApiException('version_not_found');
    return toVersionResource(row);
  }

  /** `If-Match` opcional (publicar y borrar): si viene y no acepta la revisión actual, 412. */
  private checkOptionalIfMatch(ifMatch: string | undefined, revision: number): void {
    if (ifMatch !== undefined && !matchesIfMatch(ifMatch, revision)) throw revisionMismatch(revision);
  }
}
