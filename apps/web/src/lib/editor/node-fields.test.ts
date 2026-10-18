import { schema } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { descriptorAt, DESCRIBED_TYPES, fieldsOfType, fitsField, FLOW_FIELDS, RULE_FIELDS, type FieldClass, type FieldDescriptor } from '@/lib/editor/node-fields';
import { nodeTypeLabel } from '@/lib/editor/node-types';

type Schema = Record<string, unknown>;
const defs = schema.$defs as unknown as Record<string, Schema>;

const asSchema = (value: unknown): Schema => (typeof value === 'object' && value !== null ? (value as Schema) : {});

/** Resuelve un `$ref` local a su definición. */
function resolve(value: unknown): Schema {
  const node = asSchema(value);
  return typeof node.$ref === 'string' ? asSchema(defs[node.$ref.split('/').pop()!]) : node;
}

function propertiesOf(value: unknown): Schema {
  const node = resolve(value);
  if (node.properties !== undefined) return asSchema(node.properties);
  if (node.items !== undefined) return propertiesOf(node.items);
  return {};
}

const nodeDef = (type: string) => asSchema(defs[`${type}Node`]);

/** Clase compatible con lo que dice el esquema de la propiedad. */
function compatible(cls: FieldClass, value: unknown): boolean {
  const node = resolve(value);
  switch (cls) {
    case 'integer':
      return node.type === 'integer';
    case 'number':
      return node.type === 'number';
    case 'boolean':
      return node.type === 'boolean';
    case 'enum':
      return Array.isArray(node.enum);
    case 'list':
      return node.type === 'array';
    case 'object':
    case 'headers':
      return node.type === 'object';
    case 'content':
      return node.type === 'array' && asSchema(node.items).$ref === '#/$defs/contentItem';
    case 'text':
    case 'template':
    case 'id':
    case 'target':
      return node.type === 'string';
    default:
      return true;
  }
}

function checkFields(fields: readonly FieldDescriptor[], properties: Schema, where: string): void {
  expect(fields.map((descriptor) => descriptor.key).sort(), where).toEqual(Object.keys(properties).sort());
  for (const descriptor of fields) {
    const property = properties[descriptor.key];
    expect(compatible(descriptor.cls, property), `${where}.${descriptor.key} (${descriptor.cls})`).toBe(true);
    if (descriptor.fields !== undefined) checkFields(descriptor.fields, propertiesOf(property), `${where}.${descriptor.key}`);
    if (descriptor.cls === 'enum') expect(descriptor.options, `${where}.${descriptor.key} opciones`).toEqual(resolve(property).enum);
    if (descriptor.cls === 'boolean' || descriptor.cls === 'enum') {
      const dflt = resolve(property).default;
      expect(descriptor.defaultValue, `${where}.${descriptor.key} default`).toBe(dflt);
    }
  }
}

describe('paridad de los descriptores con el esquema', () => {
  it('los ocho tipos: claves de nodeBase y del tipo, recursivamente', () => {
    expect([...DESCRIBED_TYPES].sort()).toEqual(['condition', 'end', 'http', 'input', 'jump', 'llm', 'message', 'set']);
    const base = propertiesOf(defs.nodeBase);
    for (const type of DESCRIBED_TYPES) {
      const properties = { ...base, ...propertiesOf(nodeDef(type)) };
      checkFields(fieldsOfType(type)!, properties, type);
    }
  });

  it('la raíz del flujo y la variable', () => {
    // `nodes` es el lienzo, no un campo del panel del flujo: es la única propiedad de la raíz que el panel no tiene.
    const { nodes, ...panel } = asSchema(schema.properties);
    expect(nodes).toBeDefined();
    checkFields(FLOW_FIELDS, panel, 'flujo');
  });

  it('la regla de un predicado', () => {
    checkFields(RULE_FIELDS, propertiesOf(defs.rule), 'regla');
  });
});

describe('tablas por tipo', () => {
  it('un type como constructor, toString o __proto__ es un tipo desconocido', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 5, null, {}, undefined]) {
      expect(fieldsOfType(type)).toBeNull();
    }
    expect(nodeTypeLabel('constructor')).toBe('constructor');
    expect(nodeTypeLabel('__proto__')).toBe('__proto__');
    expect(nodeTypeLabel({})).toBe('{}');
    expect(nodeTypeLabel('http')).toBe('Llamada HTTP');
  });
});

const probe = (cls: FieldClass, extra: Partial<FieldDescriptor> = {}): FieldDescriptor => ({ key: 'k', cls, label: 'k', ...extra });
const VALUES = { nulo: null, cinco: 5, texto: 'x', lista: [], objeto: {} } as const;

describe('fitsField', () => {
  it('un valor ausente encaja en todas las clases', () => {
    for (const cls of ['id', 'readonly', 'text', 'template', 'number', 'integer', 'enum', 'boolean', 'target', 'content', 'value', 'json', 'predicate', 'headers', 'object', 'list'] as FieldClass[]) {
      expect(fitsField(probe(cls), undefined), cls).toBe(true);
    }
  });

  it('matriz de cada clase contra null, 5, "x", [] y {}', () => {
    const expected: Record<string, [boolean, boolean, boolean, boolean, boolean]> = {
      // null, 5, "x", [], {}
      text: [false, false, true, false, false],
      template: [false, false, true, false, false],
      id: [false, false, true, false, false],
      target: [false, false, true, false, false],
      enum: [false, false, true, false, false],
      number: [false, true, true, false, false],
      integer: [false, true, true, false, false],
      boolean: [false, false, false, false, false],
      object: [false, false, false, false, true],
      predicate: [false, false, false, false, true],
      list: [false, false, false, true, false],
      content: [false, false, false, true, false],
      headers: [false, false, false, false, true],
      json: [true, true, true, true, true],
      readonly: [true, true, true, true, true],
      value: [true, true, true, false, false],
    };
    for (const [cls, row] of Object.entries(expected)) {
      const results = Object.values(VALUES).map((value) => fitsField(probe(cls as FieldClass), value));
      expect(results, cls).toEqual(row);
    }
  });

  it('listas con elementos que no son objetos no encajan', () => {
    expect(fitsField(probe('list'), [null])).toBe(false);
    expect(fitsField(probe('list'), [{}, 5])).toBe(false);
    expect(fitsField(probe('list'), [[]])).toBe(false);
    expect(fitsField(probe('list'), [{}, {}])).toBe(true);
  });

  it('números: infinito no, texto sí', () => {
    expect(fitsField(probe('number'), Infinity)).toBe(false);
    expect(fitsField(probe('integer'), Number.NaN)).toBe(false);
    expect(fitsField(probe('integer'), 'abc')).toBe(true);
    expect(fitsField(probe('value'), Infinity)).toBe(false);
  });

  it('cabeceras: {"x":1}, {"secret":5} y {"secret":"A","y":1} no encajan', () => {
    const headers = probe('headers');
    expect(fitsField(headers, { x: 1 })).toBe(false);
    expect(fitsField(headers, { x: { secret: 5 } })).toBe(false);
    expect(fitsField(headers, { x: { secret: 'A', y: 1 } })).toBe(false);
    expect(fitsField(headers, { x: { secret: 'A' }, y: 'texto' })).toBe(true);
    expect(fitsField(headers, {})).toBe(true);
  });

  it('when: 5, null y "x" no encajan', () => {
    for (const value of [5, null, 'x', []]) expect(fitsField(probe('predicate'), value)).toBe(false);
    expect(fitsField(probe('predicate'), { all: [] })).toBe(true);
  });

  it('value: un objeto o una lista solo donde se admite JSON', () => {
    const noJson = probe('value', { valueModes: ['string', 'number', 'boolean', 'null'] });
    const json = probe('value', { valueModes: ['string', 'json'] });
    expect(fitsField(noJson, {})).toBe(false);
    expect(fitsField(noJson, [1])).toBe(false);
    expect(fitsField(json, {})).toBe(true);
    expect(fitsField(json, [1])).toBe(true);
  });

  it('content: text, url y alt de texto según el kind', () => {
    const content = probe('content');
    expect(fitsField(content, [{ kind: 'text', text: 'a' }])).toBe(true);
    expect(fitsField(content, [{ kind: 'text', text: {} }])).toBe(false);
    expect(fitsField(content, [{ kind: 'text' }])).toBe(false);
    expect(fitsField(content, [{ kind: 'image', url: 'u' }])).toBe(true);
    expect(fitsField(content, [{ kind: 'image', url: 'u', alt: 5 }])).toBe(false);
    expect(fitsField(content, [{ kind: 'image', url: [] }])).toBe(false);
    expect(fitsField(content, [{ kind: 5, text: 'a' }])).toBe(false);
    expect(fitsField(content, [null])).toBe(false);
  });
});

describe('descriptorAt', () => {
  const flow = { nodes: [{ id: 'a', type: 'http', request: {} }, { id: 'b', type: 'condition' }] };

  it('encuentra el campo por la ruta, saltando los índices de las listas', () => {
    expect(descriptorAt(flow, ['nodes', '0', 'request', 'headers'])?.cls).toBe('headers');
    expect(descriptorAt(flow, ['nodes', '0', 'request'])?.cls).toBe('object');
    expect(descriptorAt(flow, ['nodes', '1', 'rules', '0', 'next'])?.cls).toBe('target');
    expect(descriptorAt(flow, ['nodes', '1', 'rules'])?.cls).toBe('list');
    expect(descriptorAt(flow, ['settings'])?.prunable).toBe(true);
    expect(descriptorAt(flow, ['variables', '-', 'pii'])?.cls).toBe('boolean');
  });

  it('da null para lo desconocido', () => {
    expect(descriptorAt(flow, ['nodes', '9', 'x'])).toBeNull();
    expect(descriptorAt(flow, ['nodes', '0', 'nada'])).toBeNull();
    expect(descriptorAt(flow, ['nodes', '0', 'request', 'headers', 'X'])).toBeNull();
    expect(descriptorAt(flow, ['nodes'])).toBeNull();
    expect(descriptorAt({ nodes: 'x' }, ['nodes', '0', 'a'])).toBeNull();
  });
});
