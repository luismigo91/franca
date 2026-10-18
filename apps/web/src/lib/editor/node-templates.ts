import { fixPositions } from '@/lib/editor/positions';
import type { Point } from '@/lib/editor/canvas-geometry';
import { isRecord, type FlowDoc } from '@/lib/editor/json-edit';

const text = () => [{ kind: 'text', text: '' }];

/** Plantillas de «Añadir nodo» (con solo lo que dice la spec), sin `id` ni `position`. */
const TEMPLATES: ReadonlyMap<string, () => Record<string, unknown>> = new Map([
  ['message', () => ({ content: text() })],
  ['input', () => ({ prompt: text(), inputType: 'text' })],
  ['condition', () => ({})],
  ['set', () => ({})],
  ['http', () => ({ request: { method: 'GET', url: '' } })],
  ['llm', () => ({ provider: 'principal', goal: '' })],
  ['jump', () => ({})],
  ['end', () => ({})],
]);

/**
 * El menor `<tipo>-<n>` libre, con `n` desde 1.
 *
 * @param flow El borrador.
 * @param type Tipo del nodo nuevo.
 */
export function nextNodeId(flow: Record<string, unknown>, type: string): string {
  const used = new Set((Array.isArray(flow.nodes) ? (flow.nodes as unknown[]) : []).map((node) => (isRecord(node) ? node.id : undefined)));
  let n = 1;
  while (used.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

/**
 * «Añadir nodo» (D11): fija las posiciones de todos, y añade el nuevo al final de `nodes` con su `position` en `center`
 * (enteros).
 *
 * @param flow El borrador.
 * @param type Uno de los ocho tipos.
 * @param positions Posiciones con las que se pinta cada nodo.
 * @param center Esquina del nodo nuevo (el centro de la zona visible).
 * @returns El flujo nuevo y el `id` del nodo, o `null` si el tipo no existe.
 */
export function addNode(flow: FlowDoc, type: string, positions: ReadonlyMap<string, Point>, center: Point): { flow: FlowDoc; id: string } | null {
  const template = TEMPLATES.get(type);
  if (template === undefined) return null;
  const fixed = fixPositions(flow, positions);
  const id = nextNodeId(fixed, type);
  const { content, prompt, ...rest } = template();
  const node = { id, type, position: { x: Math.round(center.x), y: Math.round(center.y) }, ...(content === undefined ? {} : { content }), ...(prompt === undefined ? {} : { prompt }), ...rest };
  const nodes = [...(Array.isArray(fixed.nodes) ? (fixed.nodes as unknown[]) : []), node];
  return { flow: Object.fromEntries(Object.entries(fixed).map(([key, value]) => [key, key === 'nodes' ? nodes : value])), id };
}

/**
 * El flujo de «Crear un flujo vacío»: `specVersion`, `id`, `name`, `start` y un nodo `end`, en ese orden de claves.
 *
 * @param id Identificador del flujo.
 * @param name Nombre.
 */
export function emptyFlow(id: string, name: string): FlowDoc {
  return { specVersion: '0.1', id, name, start: 'inicio', nodes: [{ id: 'inicio', type: 'end' }] };
}
