import { capWarnings, validateFlow, type FlowWarning } from '@franca/spec';
import type { Flow, FlowVersion } from '../generated/prisma/client.js';

/** Columnas de `flows` que lee un resumen (sin `draft`: pueden ser megabytes). */
export type FlowSummaryRow = Pick<Flow, 'id' | 'nameJson' | 'revision' | 'latestVersion' | 'unpublishedChanges' | 'createdAt' | 'updatedAt'>;
export type FlowRow = FlowSummaryRow & Pick<Flow, 'draft'>;
export type VersionSummaryRow = Pick<FlowVersion, 'flowId' | 'version' | 'nameJson' | 'publishedAt'>;
export type VersionRow = VersionSummaryRow & Pick<FlowVersion, 'definition'>;

/** Resumen de flujo (listado): el recurso sin `flow` ni `warnings`. Las claves salen en este orden. */
export interface FlowSummary {
  id: string;
  name: string;
  revision: number;
  latestVersion: number | null;
  unpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlowResource extends FlowSummary {
  /** La forma JSON del borrador, tal como se guardó. */
  flow: unknown;
  /** Los que da `validateFlow` sobre el borrador al responder, recortados para mostrar. */
  warnings: FlowWarning[];
}

export interface VersionSummary {
  flowId: string;
  version: number;
  name: string;
  publishedAt: string;
}

export interface VersionResource extends VersionSummary {
  flow: unknown;
  warnings: FlowWarning[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Avisos de un flujo guardado, recalculados con el validador vigente y recortados para mostrar. */
function warningsOf(flow: unknown): FlowWarning[] {
  return capWarnings(validateFlow(flow).warnings);
}

/**
 * Resumen de un flujo para el listado.
 *
 * @param row Fila de `flows` sin el borrador.
 * @returns El resumen, con las fechas en ISO 8601.
 */
export function toFlowSummary(row: FlowSummaryRow): FlowSummary {
  return {
    id: row.id,
    name: JSON.parse(row.nameJson) as string,
    revision: row.revision,
    latestVersion: row.latestVersion,
    unpublishedChanges: row.unpublishedChanges,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Recurso completo de un flujo: resumen, borrador y avisos.
 *
 * @param row Fila de `flows` con el borrador.
 * @param warnings Avisos que `validateFlow` ya dio sobre ese mismo borrador (sin recortar); si faltan, se recalculan.
 * @returns El recurso.
 */
export function toFlowResource(row: FlowRow, warnings?: readonly FlowWarning[]): FlowResource {
  const flow: unknown = JSON.parse(row.draft);
  return { ...toFlowSummary(row), flow, warnings: warnings ? capWarnings([...warnings]) : warningsOf(flow) };
}

/**
 * Resumen de una versión publicada para el historial.
 *
 * @param row Fila de `flow_versions` sin la definición.
 * @returns El resumen, con la fecha en ISO 8601.
 */
export function toVersionSummary(row: VersionSummaryRow): VersionSummary {
  return {
    flowId: row.flowId,
    version: row.version,
    name: JSON.parse(row.nameJson) as string,
    publishedAt: row.publishedAt.toISOString(),
  };
}

/**
 * Recurso completo de una versión: resumen, definición y avisos.
 *
 * @param row Fila de `flow_versions` con la definición.
 * @param warnings Avisos que `validateFlow` ya dio sobre esa misma definición (sin recortar); si faltan, se recalculan.
 * @returns El recurso.
 */
export function toVersionResource(row: VersionRow, warnings?: readonly FlowWarning[]): VersionResource {
  const flow: unknown = JSON.parse(row.definition);
  return { ...toVersionSummary(row), flow, warnings: warnings ? capWarnings([...warnings]) : warningsOf(flow) };
}

/**
 * Envuelve una página de elementos con su total y paginación.
 *
 * @returns La página.
 */
export function toPage<T>(items: T[], total: number, limit: number, offset: number): Page<T> {
  return { items, total, limit, offset };
}
