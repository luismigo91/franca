import { schema } from '@franca/spec';
import { isRecord } from '@/lib/editor/json-edit';

/** Clase de un campo del formulario (D8). */
export type FieldClass =
  | 'id'
  | 'readonly'
  | 'text'
  | 'template'
  | 'number'
  | 'integer'
  | 'enum'
  | 'boolean'
  | 'target'
  | 'content'
  | 'value'
  | 'json'
  | 'predicate'
  | 'headers'
  | 'object'
  | 'list';

/** Modos en que se escribe un valor (D5). */
export type ValueMode = 'string' | 'number' | 'boolean' | 'null' | 'json';

/** Un campo del inspector o del panel del flujo: su clave del esquema, su clase y lo que hace falta para pintarlo y escribirlo. */
export interface FieldDescriptor {
  readonly key: string;
  readonly cls: FieldClass;
  readonly label: string;
  /** La propiedad es obligatoria en el esquema. */
  readonly required?: boolean;
  /** Valores de un `enum`, salidos del esquema en ejecución. */
  readonly options?: readonly string[];
  /** Valor por defecto del esquema de una casilla o un `enum` (no se escribe si no se toca). */
  readonly defaultValue?: boolean | string;
  /** Campos de un `object` o de cada elemento de un `list`. */
  readonly fields?: readonly FieldDescriptor[];
  /** Objeto o lista opcional: se quita cuando se queda vacío (D5). */
  readonly prunable?: boolean;
  /** Texto de varias líneas. */
  readonly multiline?: boolean;
  /** Modos de un campo `value`. */
  readonly valueModes?: readonly ValueMode[];
  /** Nombre de un elemento de lista, para los botones («Añadir regla»). */
  readonly itemLabel?: string;
  /** Elemento nuevo de una lista, con solo lo obligatorio; recibe los que ya hay. */
  readonly newItem?: (existing: readonly unknown[]) => unknown;
}

const defs = schema.$defs;

const field = (key: string, cls: FieldClass, label: string, extra: Partial<FieldDescriptor> = {}): FieldDescriptor => ({ key, cls, label, ...extra });

function freeOptionId(existing: readonly unknown[]): string {
  const used = new Set(existing.map((item) => (isRecord(item) ? item.id : undefined)));
  let n = 1;
  while (used.has(`opcion-${n}`)) n++;
  return `opcion-${n}`;
}

const BASE: readonly FieldDescriptor[] = [
  field('id', 'id', 'Identificador', { required: true }),
  field('type', 'readonly', 'Tipo', { required: true }),
  field('title', 'text', 'Título'),
  field('position', 'readonly', 'Posición'),
];

const CONTENT = (key: string, label: string, extra: Partial<FieldDescriptor> = {}) =>
  field(key, 'content', label, { itemLabel: 'elemento', newItem: () => ({ kind: 'text', text: '' }), ...extra });

const NODE_FIELDS: ReadonlyMap<string, readonly FieldDescriptor[]> = new Map([
  ['message', [...BASE, CONTENT('content', 'Contenido', { required: true }), field('next', 'target', 'Siguiente (next)', { required: true })]],
  [
    'input',
    [
      ...BASE,
      field('inputType', 'enum', 'Tipo de respuesta', { required: true, options: defs.inputNode.properties.inputType.enum }),
      field('variable', 'text', 'Variable', { required: true }),
      CONTENT('prompt', 'Pregunta', { required: true }),
      field('placeholder', 'text', 'Texto de ayuda'),
      field('validation', 'object', 'Validación', {
        prunable: true,
        fields: [
          field('pattern', 'text', 'Patrón'),
          field('min', 'number', 'Mínimo'),
          field('max', 'number', 'Máximo'),
          field('retryMessage', 'template', 'Mensaje al reintentar'),
          field('maxRetries', 'integer', 'Reintentos máximos'),
        ],
      }),
      field('choices', 'list', 'Opciones', {
        itemLabel: 'opción',
        newItem: (existing) => ({ id: freeOptionId(existing), label: '' }),
        fields: [
          field('id', 'text', 'Identificador', { required: true }),
          field('label', 'template', 'Texto', { required: true }),
          field('value', 'value', 'Valor', { valueModes: ['string', 'number', 'boolean'] }),
          field('imageUrl', 'template', 'Imagen (URL)'),
          field('next', 'target', 'Siguiente (next)'),
        ],
      }),
      field('multiple', 'boolean', 'Selección múltiple', { defaultValue: false }),
      field('next', 'target', 'Siguiente (next)'),
    ],
  ],
  [
    'condition',
    [
      ...BASE,
      field('rules', 'list', 'Reglas', {
        required: true,
        itemLabel: 'regla',
        newItem: () => ({ when: { variable: '', op: 'eq' } }),
        fields: [field('when', 'predicate', 'Condición', { required: true }), field('next', 'target', 'Siguiente (next)', { required: true })],
      }),
      field('else', 'target', 'Si no (else)', { required: true }),
    ],
  ],
  [
    'set',
    [
      ...BASE,
      field('assignments', 'list', 'Asignaciones', {
        required: true,
        itemLabel: 'asignación',
        newItem: () => ({ variable: '', value: '' }),
        fields: [
          field('variable', 'text', 'Variable', { required: true }),
          field('value', 'value', 'Valor', { required: true, valueModes: ['string', 'number', 'boolean', 'null'] }),
        ],
      }),
      field('next', 'target', 'Siguiente (next)', { required: true }),
    ],
  ],
  [
    'http',
    [
      ...BASE,
      field('request', 'object', 'Petición', {
        required: true,
        fields: [
          field('method', 'enum', 'Método', { required: true, options: defs.httpNode.properties.request.properties.method.enum }),
          field('url', 'template', 'URL', { required: true }),
          field('headers', 'headers', 'Cabeceras', { prunable: true }),
          field('body', 'json', 'Cuerpo (JSON)'),
        ],
      }),
      field('timeoutMs', 'integer', 'Plazo (ms)'),
      field('retries', 'integer', 'Reintentos'),
      field('responseMap', 'list', 'Variables de la respuesta', {
        prunable: true,
        itemLabel: 'variable de la respuesta',
        newItem: () => ({ variable: '', pointer: '' }),
        fields: [field('variable', 'text', 'Variable', { required: true }), field('pointer', 'text', 'Puntero JSON', { required: true })],
      }),
      field('next', 'target', 'Siguiente (next)', { required: true }),
      field('onError', 'target', 'Si falla (onError)', { required: true }),
    ],
  ],
  [
    'llm',
    [
      ...BASE,
      field('provider', 'text', 'Proveedor (nombre)', { required: true }),
      field('model', 'text', 'Modelo'),
      field('system', 'template', 'Instrucciones (system)', { multiline: true }),
      field('goal', 'template', 'Objetivo', { required: true, multiline: true }),
      field('slots', 'list', 'Datos que recoge', {
        prunable: true,
        itemLabel: 'dato',
        newItem: () => ({ variable: '', description: '' }),
        fields: [
          field('variable', 'text', 'Variable', { required: true }),
          field('description', 'text', 'Descripción', { required: true }),
          field('required', 'boolean', 'Obligatorio', { defaultValue: true }),
        ],
      }),
      field('maxTurns', 'integer', 'Turnos máximos'),
      field('costCapUsd', 'number', 'Tope de coste (USD)'),
      field('temperature', 'number', 'Temperatura'),
      field('next', 'target', 'Siguiente (next)', { required: true }),
      field('onExhausted', 'target', 'Si se agota (onExhausted)', { required: true }),
    ],
  ],
  ['jump', [...BASE, field('target', 'target', 'Destino (target)', { required: true })]],
  ['end', [...BASE, CONTENT('content', 'Contenido', { prunable: true }), field('outcome', 'text', 'Resultado (outcome)')]],
]);

/** Campos del panel del flujo (D8). */
export const FLOW_FIELDS: readonly FieldDescriptor[] = [
  field('specVersion', 'readonly', 'Versión de la spec', { required: true }),
  field('id', 'readonly', 'Identificador', { required: true }),
  field('name', 'text', 'Nombre', { required: true }),
  field('description', 'text', 'Descripción', { multiline: true }),
  field('locale', 'text', 'Idioma (locale)'),
  field('settings', 'object', 'Ajustes', {
    prunable: true,
    fields: [field('typingDelayMs', 'integer', 'Retardo de escritura (ms)'), field('sessionTimeoutMinutes', 'integer', 'Caducidad de la sesión (min)')],
  }),
  field('start', 'target', 'Nodo de inicio (start)', { required: true }),
  field('variables', 'list', 'Variables', {
    prunable: true,
    itemLabel: 'variable',
    newItem: () => ({ name: '', type: 'string' }),
    fields: [
      field('name', 'text', 'Nombre de la variable', { required: true }),
      field('type', 'enum', 'Tipo de la variable', { required: true, options: defs.variable.properties.type.enum }),
      field('scope', 'enum', 'Ámbito de la variable', { options: defs.variable.properties.scope.enum, defaultValue: 'session' }),
      field('pii', 'boolean', 'Dato personal', { defaultValue: false }),
      field('description', 'text', 'Descripción de la variable'),
      field('default', 'value', 'Valor por defecto', { valueModes: ['string', 'number', 'boolean', 'null', 'json'] }),
    ],
  }),
];

/** Los campos del rule de un predicado (regla simple). */
export const RULE_FIELDS: readonly FieldDescriptor[] = [
  field('variable', 'text', 'Variable', { required: true }),
  field('op', 'enum', 'Operador', { required: true, options: defs.rule.properties.op.enum }),
  field('value', 'value', 'Valor', { valueModes: ['string', 'number', 'boolean', 'null', 'json'] }),
];

/**
 * Campos de un tipo de nodo. Es un `Map`: un `type` como `constructor` o `__proto__` da `null` («tipo desconocido»).
 *
 * @param type El `type` del nodo, de cualquier tipo.
 */
export function fieldsOfType(type: unknown): readonly FieldDescriptor[] | null {
  return (typeof type === 'string' ? NODE_FIELDS.get(type) : undefined) ?? null;
}

/** Los tipos de nodo con descriptor, para las pruebas de paridad. */
export const DESCRIBED_TYPES: readonly string[] = [...NODE_FIELDS.keys()];

function isNumberOrText(value: unknown): boolean {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function isHeaderValue(value: unknown): boolean {
  if (typeof value === 'string') return true;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === 'secret' && typeof value.secret === 'string';
}

function fitsContent(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((item: unknown) => {
    if (!isRecord(item) || typeof item.kind !== 'string') return false;
    const textOrAbsent = (name: string) => item[name] === undefined || typeof item[name] === 'string';
    return item.kind === 'text' ? typeof item.text === 'string' : typeof item.url === 'string' && textOrAbsent('alt');
  });
}

/**
 * Indica si un valor encaja en la clase de su campo: el formulario solo pinta un campo si encaja; si no, pasa a JSON libre.
 * Un valor ausente (`undefined`) encaja en todo.
 *
 * @param descriptor El campo.
 * @param value El valor del flujo, de cualquier tipo.
 */
export function fitsField(descriptor: FieldDescriptor, value: unknown): boolean {
  if (value === undefined) return true;
  switch (descriptor.cls) {
    case 'id':
    case 'text':
    case 'template':
    case 'target':
    case 'enum':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return isNumberOrText(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
    case 'predicate':
      return isRecord(value);
    case 'list':
      return Array.isArray(value) && value.every(isRecord);
    case 'content':
      return fitsContent(value);
    case 'headers':
      return isRecord(value) && Object.values(value).every(isHeaderValue);
    case 'value': {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
      if (typeof value === 'number') return Number.isFinite(value);
      return descriptor.valueModes?.includes('json') === true;
    }
    case 'json':
    case 'readonly':
      return true;
  }
}

function arrayIndex(segment: string): boolean {
  return segment === '-' || /^(0|[1-9][0-9]*)$/.test(segment);
}

function walk(fields: readonly FieldDescriptor[], segments: readonly string[]): FieldDescriptor | null {
  let current = fields;
  for (let i = 0; i < segments.length; i++) {
    const found = current.find((candidate) => candidate.key === segments[i]);
    if (found === undefined) return null;
    if (i === segments.length - 1) return found;
    if (found.cls === 'list') {
      const index = segments[i + 1];
      if (index === undefined || !arrayIndex(index)) return null;
      if (i + 1 === segments.length - 1) return null;
      i += 1;
      current = found.fields ?? [];
    } else if (found.cls === 'object') {
      current = found.fields ?? [];
    } else {
      return null;
    }
  }
  return null;
}

/**
 * El descriptor del campo al que apunta una ruta del flujo (`['nodes', '3', 'request', 'headers']`), o `null`. Los
 * elementos de una lista se saltan (`['nodes', '3', 'rules', '0', 'next']` da el campo `next` de las reglas).
 *
 * @param flow El flujo (para saber el `type` del nodo).
 * @param segments Segmentos de la ruta, sin escapar.
 */
export function descriptorAt(flow: Record<string, unknown>, segments: readonly string[]): FieldDescriptor | null {
  if (segments[0] === 'nodes') {
    const nodes = flow.nodes;
    const at = segments[1];
    if (!Array.isArray(nodes) || at === undefined || !/^(0|[1-9][0-9]*)$/.test(at)) return null;
    const node: unknown = nodes[Number(at)];
    const fields = isRecord(node) ? fieldsOfType(node.type) : null;
    return fields === null || segments.length < 3 ? null : walk(fields, segments.slice(2));
  }
  return walk(FLOW_FIELDS, segments);
}
