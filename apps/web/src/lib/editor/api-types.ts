import { isRecord, type FlowDoc } from '@/lib/editor/json-edit';

/** El recurso flujo de la API: lo que usa el editor. `flow` es el borrador tal como lo guardó la API. */
export interface FlowResource {
  id: string;
  name: string;
  revision: number;
  latestVersion: number | null;
  unpublishedChanges: boolean;
  flow: FlowDoc;
}

/** Respuesta de publicar: la versión y su nombre. */
export interface VersionResource {
  flowId: string;
  version: number;
  name: string;
}

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/** El borrador tiene la estructura mínima que el editor da por cierta (D25): `nodes` lista de objetos con `id` de texto y `start` de texto. */
function readFlow(value: unknown): FlowDoc | null {
  if (!isRecord(value) || typeof value.start !== 'string' || !Array.isArray(value.nodes)) return null;
  return value.nodes.every((node: unknown) => isRecord(node) && typeof node.id === 'string') ? value : null;
}

/**
 * Lee un recurso flujo o `null` si no tiene la forma de la API. No valida el flujo: eso lo hace `validateFlow`.
 *
 * @param value El cuerpo de la respuesta.
 */
export function readFlowResource(value: unknown): FlowResource | null {
  if (!isRecord(value)) return null;
  const flow = readFlow(value.flow);
  if (
    flow === null ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isInteger(value.revision) ||
    !(value.latestVersion === null || isInteger(value.latestVersion)) ||
    typeof value.unpublishedChanges !== 'boolean'
  ) {
    return null;
  }
  return { id: value.id, name: value.name, revision: value.revision, latestVersion: value.latestVersion, unpublishedChanges: value.unpublishedChanges, flow };
}

/** Lee la respuesta de publicar o `null`. */
export function readVersionResource(value: unknown): VersionResource | null {
  if (!isRecord(value) || typeof value.flowId !== 'string' || !isInteger(value.version) || typeof value.name !== 'string') return null;
  return { flowId: value.flowId, version: value.version, name: value.name };
}
