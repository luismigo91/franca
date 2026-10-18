import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import { asText } from '@/lib/editor/as-text';
import { canvasModel } from '@/lib/editor/canvas-model';
import { addItem, writeBoolean, writeEnum, writeJson, writeNumber, writeText, writeValue } from '@/lib/editor/fields';
import { getIn, isRecord, parsePointer, pointerOf, type Change, type FlowDoc } from '@/lib/editor/json-edit';
import { autoLayout, displayPositions } from '@/lib/editor/layout';
import { connectOutput } from '@/lib/editor/node-ops';
import { descriptorAt, fieldsOfType, fitsField, type FieldDescriptor } from '@/lib/editor/node-fields';
import { nodeTypeLabel } from '@/lib/editor/node-types';
import { nodeOutputs } from '@/lib/editor/outputs';
import { fixPositions } from '@/lib/editor/positions';
import { renameNode } from '@/lib/editor/rename';
import { problemsOf } from '@/lib/editor/issues-view';
import { readFlowResource } from '@/lib/editor/api-types';
import { validateDraft } from '@/lib/editor/validate-draft';

// D25: todo lugar que lee un valor del flujo, contra un borrador con cada propiedad sustituida por un valor de otro tipo.

const BAD_VALUES: unknown[] = [null, 5, 'x', [], {}, JSON.parse(JSON.stringify(JSON.parse('1e400')))];

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;

/** Un nodo de cada tipo (más las dos formas de input) dentro del flujo del que sale. */
const SAMPLES: { name: string; flow: () => FlowDoc; id: string }[] = [
  { name: 'message', flow: () => clone('captacion-leads'), id: 'bienvenida' },
  { name: 'input texto', flow: () => clone('captacion-leads'), id: 'pedir-email' },
  { name: 'input choice', flow: () => clone('captacion-leads'), id: 'pedir-tamano' },
  { name: 'condition', flow: () => clone('captacion-leads'), id: 'ruta-segmento' },
  { name: 'set', flow: () => clone('captacion-leads'), id: 'marcar-pyme' },
  { name: 'http', flow: () => clone('captacion-leads'), id: 'enviar-crm' },
  { name: 'llm', flow: () => clone('faq-ia'), id: 'asistente' },
  { name: 'end', flow: () => clone('captacion-leads'), id: 'fin-empresa' },
  {
    name: 'jump',
    flow: () => {
      const flow = clone('captacion-leads');
      (flow.nodes as unknown[]).push({ id: 'saltar', type: 'jump', target: 'bienvenida' });
      return flow;
    },
    id: 'saltar',
  },
];

/** Los punteros de todo valor dentro de un nodo (él mismo no). */
function innerPointers(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((item, index) => [[...prefix, index], ...innerPointers(item, [...prefix, index])]);
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => [[...prefix, key], ...innerPointers(item, [...prefix, key])]);
  return [];
}

function replaceAt(flow: FlowDoc, nodeIndex: number, path: (string | number)[], value: unknown): FlowDoc {
  const copy = structuredClone(flow);
  let current: unknown = (copy.nodes as unknown[])[nodeIndex];
  for (const segment of path.slice(0, -1)) current = (current as Record<string, unknown>)[String(segment)];
  (current as Record<string, unknown>)[String(path.at(-1))] = value;
  return copy;
}

/** Cada campo del descriptor sobre su valor en el nodo, también los anidados. */
function checkFits(fields: readonly FieldDescriptor[], container: unknown): void {
  for (const descriptor of fields) {
    const value = isRecord(container) ? (Object.hasOwn(container, descriptor.key) ? container[descriptor.key] : undefined) : undefined;
    const fits = fitsField(descriptor, value);
    if (!fits || descriptor.fields === undefined) continue;
    if (descriptor.cls === 'object') checkFits(descriptor.fields, value);
    if (descriptor.cls === 'list' && Array.isArray(value)) for (const item of value) checkFits(descriptor.fields, item);
  }
}

/** Todo lo que el editor hace con un borrador, sin lanzar y sin [object Object] en los textos. */
function exercise(flow: FlowDoc, where: string): void {
  const positions = displayPositions(flow);
  const model = canvasModel(flow, positions);
  autoLayout(flow);
  fixPositions(flow, positions);
  const texts: string[] = [];
  for (const node of model.nodes) texts.push(node.id, nodeTypeLabel(node.type), asText(node.title), ...node.outputs.map((output) => output.key));
  for (const edge of model.edges) texts.push(edge.label, edge.toId);
  (flow.nodes as unknown[]).forEach((raw, index) => {
    for (const output of nodeOutputs(raw)) {
      const result = connectOutput(flow, positions, String((raw as Record<string, unknown>).id), output.pointer, String(flow.start));
      expect(result.ok, `${where}: connectOutput ${output.pointer}`).toBe(true);
    }
    renameNode(flow, String((raw as Record<string, unknown>).id), `renombrado-${index}`);
    const fields = fieldsOfType((raw as Record<string, unknown>).type);
    if (fields !== null) checkFits(fields, raw);
  });
  const verdict = validateDraft(flow);
  for (const problem of problemsOf(verdict)) texts.push(problem.message, asText(problem.nodeId));
  JSON.stringify(flow);
  for (const text of texts) expect(text, where).not.toContain('[object Object]');
}

describe('flujos mal formados (D25)', () => {
  for (const sample of SAMPLES) {
    it(`${sample.name}: cada propiedad, también las anidadas, sustituida por null, 5, "x", [], {} y 1e400`, () => {
      const flow = sample.flow();
      const index = (flow.nodes as { id: string }[]).findIndex((node) => node.id === sample.id);
      const node = (flow.nodes as unknown[])[index];
      let variants = 0;
      for (const path of innerPointers(node)) {
        // El id de un nodo es un texto por invariante (D25): lo garantizan renombrar y «Editar como JSON».
        if (path.length === 1 && path[0] === 'id') continue;
        for (const bad of BAD_VALUES) {
          exercise(replaceAt(flow, index, path, bad), `${sample.name} ${pointerOf(path)} = ${JSON.stringify(bad)}`);
          variants += 1;
        }
      }
      expect(variants).toBeGreaterThan(10);
    });
  }

  it('type de cualquier tipo no lanza', () => {
    for (const bad of [...BAD_VALUES, 'constructor', '__proto__', 'toString']) {
      const flow = clone('captacion-leads');
      (flow.nodes as Record<string, unknown>[])[1]!.type = bad;
      exercise(flow, `type = ${JSON.stringify(bad)}`);
    }
  });
});

/** La escritura que haría el inspector para un campo de esa clase, sobre un puntero. */
function writeFor(descriptor: FieldDescriptor, pointer: string): Change | null {
  switch (descriptor.cls) {
    case 'text':
    case 'template':
    case 'target':
    case 'id':
      return writeText(pointer, 'x', true);
    case 'enum':
      return writeEnum(pointer, descriptor.options?.[0] ?? 'x');
    case 'number':
    case 'integer':
      return writeNumber(pointer, '3', false);
    case 'boolean':
      return writeBoolean(pointer, descriptor.defaultValue !== true, descriptor.defaultValue === true);
    case 'value':
      return writeValue(pointer, 'string', 'x');
    case 'json':
    case 'predicate':
      return writeJson(pointer, '{}', false);
    default:
      return null;
  }
}

describe('propiedad ausente: escribir cada campo anidado crea el contenedor al final y no lanza', () => {
  for (const sample of SAMPLES) {
    it(sample.name, () => {
      const flow = sample.flow();
      const index = (flow.nodes as { id: string }[]).findIndex((node) => node.id === sample.id);
      const fields = fieldsOfType((flow.nodes as Record<string, unknown>[])[index]!.type)!;
      for (const container of fields.filter((field) => field.fields !== undefined)) {
        const without = structuredClone(flow);
        delete (without.nodes as Record<string, unknown>[])[index]![container.key];
        const base = `/nodes/${index}/${container.key}`;
        for (const field of container.fields!) {
          let draft = without;
          let pointer = `${base}/${field.key}`;
          if (container.cls === 'list') {
            const added = addItem(base, container)(draft, null);
            expect(added.ok, `${container.key}`).toBe(true);
            if (!added.ok) continue;
            draft = added.flow;
            expect((getIn(draft, base) as unknown[]).length).toBe(1);
            pointer = `${base}/0/${field.key}`;
          }
          const change = writeFor(field, pointer);
          if (change === null) continue;
          const result = change(draft, null);
          expect(result.ok, `${container.key}.${field.key}`).toBe(true);
          if (!result.ok) continue;
          const node = (result.flow.nodes as Record<string, unknown>[])[index]!;
          expect(Object.keys(node).at(-1), `${container.key}.${field.key} se crea al final`).toBe(container.key);
          expect(Array.isArray(node[container.key]), `${container.key} es lista`).toBe(container.cls === 'list');
          // Y el descriptor que decide el tipo es el de la ruta.
          expect(descriptorAt(result.flow, parsePointer(base))?.key).toBe(container.key);
          if (container.cls === 'object' && container.prunable === true && field.cls !== 'boolean') {
            const cleared = (field.cls === 'number' || field.cls === 'integer' ? writeNumber(pointer, '', false) : writeText(pointer, '', false))(result.flow, null);
            expect(cleared.ok && Object.hasOwn((cleared.flow.nodes as Record<string, unknown>[])[index]!, container.key), `${container.key}.${field.key} se poda`).toBe(false);
          }
        }
      }
    });
  }
});

describe('readFlowResource ante un borrador mal formado', () => {
  it('rechaza nodes que no es una lista de objetos, un id que no es texto y un start que no es texto', () => {
    const body = (flow: unknown) => ({ id: 'a', name: 'A', revision: 1, latestVersion: null, unpublishedChanges: true, flow });
    expect(readFlowResource(body({ start: 'a', nodes: 'x' }))).toBeNull();
    expect(readFlowResource(body({ start: 'a', nodes: [5] }))).toBeNull();
    expect(readFlowResource(body({ start: 'a', nodes: [{ id: {} }] }))).toBeNull();
    expect(readFlowResource(body({ start: {}, nodes: [{ id: 'a' }] }))).toBeNull();
    expect(readFlowResource(body({ start: 'a', nodes: [{ id: 'a' }] }))).not.toBeNull();
  });
});
