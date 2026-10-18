import { validateFlow } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import {
  addHeader,
  addItem,
  modeOfValue,
  removeHeader,
  removeItem,
  renameHeader,
  setContentKind,
  writeBoolean,
  writeEnum,
  writeHeader,
  writeJson,
  writeNumber,
  writeTarget,
  writeText,
  writeValue,
} from '@/lib/editor/fields';
import type { Change, FlowDoc } from '@/lib/editor/json-edit';
import { fieldsOfType, FLOW_FIELDS } from '@/lib/editor/node-fields';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const text = (value: unknown) => JSON.stringify(value);
const CAPTACION = clone('captacion-leads');
const NODE = Object.fromEntries((CAPTACION.nodes as { id: string }[]).map((node, index) => [node.id, index]));

/** Aplica una edición contra un guardado (por defecto, el propio flujo) y devuelve el flujo. */
function run(change: Change, flow: FlowDoc = CAPTACION, saved: FlowDoc | null = flow): FlowDoc {
  const result = change(structuredClone(flow), saved === null ? null : structuredClone(saved));
  if (!result.ok) throw new Error(`la edición falló: ${result.error}`);
  return result.flow;
}

const nodeAt = (flow: FlowDoc, id: string) => (flow.nodes as Record<string, unknown>[])[NODE[id]!]!;

describe('golden: el texto que recibe la API', () => {
  it('Editar un campo no reordena el nodo', () => {
    const changed = run(writeText(`/nodes/${NODE['pedir-email']}/validation/retryMessage`, 'Revísalo, por favor.', false));
    expect(text(changed)).toBe(text(CAPTACION).replace('Ese email no parece válido, ¿lo revisas?', 'Revísalo, por favor.'));
  });

  it('Vaciar un campo opcional', () => {
    const changed = run(writeNumber(`/nodes/${NODE['pedir-email']}/validation/maxRetries`, '', false));
    expect(text(nodeAt(changed, 'pedir-email').validation)).toBe('{"retryMessage":"Ese email no parece válido, ¿lo revisas?"}');
    expect(text(changed)).toBe(text(CAPTACION).replace(',"maxRetries":2', ''));
  });
});

describe('texto', () => {
  it('se escribe tal cual, sin recortar', () => {
    const changed = run(writeText('/name', '  Otro  ', true));
    expect(changed.name).toBe('  Otro  ');
  });

  it('vacío en uno opcional quita la propiedad; en uno obligatorio escribe ""', () => {
    expect(Object.hasOwn(run(writeText('/description', '', false)), 'description')).toBe(false);
    expect(run(writeText('/name', '', true)).name).toBe('');
    const withDescription = run(writeText('/description', 'x', false));
    expect(text(withDescription)).toContain('"description":"x"');
    expect(Object.hasOwn(run(writeText('/description', '', false), withDescription, CAPTACION), 'description')).toBe(false);
  });
});

describe('numéricos', () => {
  const pointer = `/nodes/${NODE['enviar-crm']}/timeoutMs`;
  const timeout = (raw: string) => nodeAt(run(writeNumber(pointer, raw, false)), 'enviar-crm').timeoutMs;

  it('guarda un número si el texto es decimal y finito', () => {
    expect(timeout('1.50')).toBe(1.5);
    expect(timeout('-3')).toBe(-3);
    expect(timeout('08')).toBe(8);
    expect(timeout('9000')).toBe(9000);
  });

  it('si no, guarda el texto, para que lo señale el validador', () => {
    expect(timeout('abc')).toBe('abc');
    expect(timeout('1e3')).toBe('1e3');
    expect(timeout('1,5')).toBe('1,5');
    expect(timeout(' 5')).toBe(' 5');
    expect(timeout('')).toBeUndefined();
  });

  it('una cifra de 400 dígitos se queda como texto: Number daría Infinity', () => {
    const long = '9'.repeat(400);
    expect(timeout(long)).toBe(long);
  });

  it('abc en timeoutMs da «debe ser de tipo integer» en el nodo', () => {
    const changed = run(writeNumber(pointer, 'abc', false));
    const verdict = validateFlow(changed);
    expect(verdict.issues.map((issue) => `${issue.nodeId}: ${issue.message}`)).toContain('enviar-crm: debe ser de tipo integer');
  });
});

describe('JSON libre', () => {
  it('aplica la ida y vuelta por JSON: 1e400 se queda en null', () => {
    const changed = run(writeJson(`/nodes/${NODE['enviar-crm']}/request/body`, '{"a":1e400}', false));
    expect(text((nodeAt(changed, 'enviar-crm').request as { body: unknown }).body)).toBe('{"a":null}');
  });

  it('un JSON inválido no escribe nada', () => {
    const result = writeJson('/nodes/0/x', '{"a":', false)(structuredClone(CAPTACION), CAPTACION);
    expect(result).toEqual({ ok: false, error: 'El texto no es JSON.' });
  });

  it('vacío en uno opcional quita la propiedad (request.body)', () => {
    const changed = run(writeJson(`/nodes/${NODE['enviar-crm']}/request/body`, '  ', false));
    expect(Object.hasOwn(nodeAt(changed, 'enviar-crm').request as object, 'body')).toBe(false);
  });

  it('rechaza un JSON que anidaría más de 1000 niveles, antes de serializar', () => {
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    const result = writeJson(`/nodes/${NODE['enviar-crm']}/request/body`, deep, false)(structuredClone(CAPTACION), CAPTACION);
    expect(result).toEqual({ ok: false, error: 'El JSON anida demasiados niveles: el máximo es 1000.' });
  });
});

describe('lista cerrada', () => {
  it('escribe el valor y «(por defecto)» quita la propiedad', () => {
    const scope = (flow: FlowDoc) => (flow.variables as Record<string, unknown>[])[0]!.scope;
    const contact = run(writeEnum('/variables/0/scope', 'contact'));
    expect(scope(contact)).toBe('contact');
    expect(Object.hasOwn((run(writeEnum('/variables/1/scope', null), contact, CAPTACION).variables as object[])[1]!, 'scope')).toBe(false);
  });
});

describe('casillas', () => {
  it('marcar escribe true; desmarcar quita la propiedad (no escribe el default) y deja el texto como estaba', () => {
    const marked = run(writeBoolean('/variables/2/pii', true, false));
    expect((marked.variables as Record<string, unknown>[])[2]).toEqual({ name: 'tamano', type: 'string', pii: true });
    const unmarked = run(writeBoolean('/variables/2/pii', false, false), marked, CAPTACION);
    expect(text(unmarked)).toBe(text(CAPTACION));
  });

  it('nunca escribe un default que no estaba (mutante writeDefaults)', () => {
    const noPii = run(writeBoolean('/variables/2/pii', false, false));
    expect(text(noPii)).toBe(text(CAPTACION));
  });

  it('si el último guardado tenía "pii": false escrito, desmarcar lo vuelve a escribir en su sitio (forgetSavedDefault)', () => {
    const saved = structuredClone(CAPTACION);
    (saved.variables as Record<string, unknown>[])[2] = { name: 'tamano', type: 'string', pii: false };
    const marked = run(writeBoolean('/variables/2/pii', true, false), saved, saved);
    const unmarked = run(writeBoolean('/variables/2/pii', false, false), marked, saved);
    expect(text(unmarked)).toBe(text(saved));
  });

  it('con un guardado con "pii": true, desmarcar quita la propiedad', () => {
    const unmarked = run(writeBoolean('/variables/0/pii', false, false));
    expect((unmarked.variables as Record<string, unknown>[])[0]).toEqual({ name: 'nombre', type: 'string' });
  });

  it('una casilla con default true (required) marcada de nuevo quita la propiedad', () => {
    const flow = clone('faq-ia');
    const unrequired = run(writeBoolean('/nodes/1/slots/0/required', false, true), flow, flow);
    expect(((unrequired.nodes as Record<string, unknown>[])[1]!.slots as Record<string, unknown>[])[0]).toEqual({ variable: 'resuelto', description: 'true si el usuario confirma que su duda está resuelta', required: false });
    const back = run(writeBoolean('/nodes/1/slots/0/required', true, true), unrequired, flow);
    expect(text(back)).toBe(text(flow));
  });
});

describe('saltos', () => {
  it('un destino lo escribe; «(ninguno)» quita la propiedad', () => {
    const pointer = `/nodes/${NODE['pedir-nombre']}/next`;
    expect(nodeAt(run(writeTarget(pointer, 'bienvenida')), 'pedir-nombre').next).toBe('bienvenida');
    expect(Object.hasOwn(nodeAt(run(writeTarget(pointer, null)), 'pedir-nombre'), 'next')).toBe(false);
  });
});

describe('valor en sus modos', () => {
  const pointer = `/nodes/${NODE['marcar-pyme']}/assignments/0/value`;
  const valueOf = (change: Change) => ((nodeAt(run(change), 'marcar-pyme').assignments as Record<string, unknown>[])[0] as { value?: unknown }).value;

  it('texto, número, sí/no, nulo y JSON', () => {
    expect(valueOf(writeValue(pointer, 'string', 'x'))).toBe('x');
    expect(valueOf(writeValue(pointer, 'number', '12.5'))).toBe(12.5);
    expect(valueOf(writeValue(pointer, 'boolean', 'true'))).toBe(true);
    expect(valueOf(writeValue(pointer, 'boolean', 'false'))).toBe(false);
    expect(valueOf(writeValue(pointer, 'null', ''))).toBeNull();
    expect(valueOf(writeValue(pointer, 'json', '{"a":[1]}'))).toEqual({ a: [1] });
  });

  it('«(ninguno)» quita la propiedad; un número mal escrito o un JSON inválido no escriben', () => {
    expect(valueOf(writeValue(pointer, 'none', ''))).toBeUndefined();
    expect(writeValue(pointer, 'number', 'abc')(structuredClone(CAPTACION), CAPTACION)).toEqual({ ok: false, error: 'No es un número.' });
    expect(writeValue(pointer, 'json', '{')(structuredClone(CAPTACION), CAPTACION)).toEqual({ ok: false, error: 'El texto no es JSON.' });
  });

  it('el modo de un valor del flujo', () => {
    expect([undefined, null, 'a', 1, true, {}, []].map(modeOfValue)).toEqual(['none', 'null', 'string', 'number', 'boolean', 'json', 'json']);
  });
});

describe('contenedores opcionales vacíos', () => {
  it('se quita el objeto o la lista opcionales que se quedan vacíos (settings, validation, headers, variables…)', () => {
    const faq = clone('faq-ia');
    const noSettings = run(writeNumber('/settings/typingDelayMs', '', false), faq, faq);
    expect(Object.hasOwn(noSettings, 'settings')).toBe(false);
    const flow = clone('captacion-leads');
    const crm = NODE['enviar-crm'];
    const onlyContentType = run(removeHeader(`/nodes/${crm}/request/headers`, 'Authorization'), flow, flow);
    const none = run(removeHeader(`/nodes/${crm}/request/headers`, 'Content-Type'), onlyContentType, flow);
    expect(Object.hasOwn((nodeAt(none, 'enviar-crm').request as object), 'headers')).toBe(false);
    const noVariables = run(removeItem('/variables/0'), run(removeItem('/variables/0'), run(removeItem('/variables/0'), run(removeItem('/variables/0')))));
    expect(Object.hasOwn(noVariables, 'variables')).toBe(false);
  });

  it('los obligatorios se quedan vacíos y el validador los señala (content de un message, rules, choices)', () => {
    const emptied = run(removeItem('/nodes/0/content/0'));
    expect(nodeAt(emptied, 'bienvenida').content).toEqual([]);
    const noRules = run(removeItem(`/nodes/${NODE['ruta-segmento']}/rules/0`));
    expect(nodeAt(noRules, 'ruta-segmento').rules).toEqual([]);
  });

  it('el content de un end opcional se quita al vaciarlo', () => {
    const cleared = run(removeItem(`/nodes/${NODE['fin-pyme']}/content/0`));
    expect(Object.hasOwn(nodeAt(cleared, 'fin-pyme'), 'content')).toBe(false);
  });

  it('un contenedor que el guardado tenía vacío no se poda (headers vacío guardado)', () => {
    const crm = NODE['enviar-crm'];
    const saved = structuredClone(CAPTACION);
    (nodeAt(saved, 'enviar-crm').request as Record<string, unknown>).headers = {};
    const added = run(addHeader(`/nodes/${crm}/request/headers`, 'X-Id', 'text', '1'), saved, saved);
    expect(text(nodeAt(added, 'enviar-crm').request)).toContain('"headers":{"X-Id":"1"}');
    const removed = run(removeHeader(`/nodes/${crm}/request/headers`, 'X-Id'), added, saved);
    expect(text(removed)).toBe(text(saved));
  });

  it('un contenedor que el guardado no tenía vacío sí se poda', () => {
    const crm = NODE['enviar-crm'];
    const flow = structuredClone(CAPTACION);
    (nodeAt(flow, 'enviar-crm').request as Record<string, unknown>).headers = { 'X-Id': '1' };
    const removed = run(removeHeader(`/nodes/${crm}/request/headers`, 'X-Id'), flow, CAPTACION);
    expect(Object.hasOwn(nodeAt(removed, 'enviar-crm').request as object, 'headers')).toBe(false);
  });

  it('vaciar y reescribir validation de pedir-email lo deja en su sitio de clave original', () => {
    const base = `/nodes/${NODE['pedir-email']}/validation`;
    const noRetry = run(writeText(`${base}/retryMessage`, '', false));
    const empty = run(writeNumber(`${base}/maxRetries`, '', false), noRetry, CAPTACION);
    expect(Object.hasOwn(nodeAt(empty, 'pedir-email'), 'validation')).toBe(false);
    const rewritten = run(writeText(`${base}/retryMessage`, 'Ese email no parece válido, ¿lo revisas?', false), empty, CAPTACION);
    expect(Object.keys(nodeAt(rewritten, 'pedir-email'))).toEqual(Object.keys(nodeAt(CAPTACION, 'pedir-email')));
    const back = run(writeNumber(`${base}/maxRetries`, '2', false), rewritten, CAPTACION);
    expect(text(back)).toBe(text(CAPTACION));
  });
});

describe('Cambio deshecho a mano', () => {
  it('añadir y quitar una cabecera, o vaciar y reescribir, deja el texto como estaba', () => {
    const crm = NODE['enviar-crm'];
    const added = run(addHeader(`/nodes/${crm}/request/headers`, 'X-Extra', 'text', 'a'));
    expect(text(run(removeHeader(`/nodes/${crm}/request/headers`, 'X-Extra'), added, CAPTACION))).toBe(text(CAPTACION));
  });
});

describe('plantillas de elementos nuevos', () => {
  const add = (pointer: string, flow: FlowDoc = CAPTACION) => {
    const [, , index, key] = pointer.split('/');
    const descriptor = pointer.startsWith('/nodes')
      ? fieldsOfType((flow.nodes as { type: string }[])[Number(index)]!.type)!.find((field) => field.key === key)!
      : FLOW_FIELDS.find((field) => field.key === pointer.slice(1))!;
    return run(addItem(pointer, descriptor), flow, flow);
  };

  it('variable, opción, regla, asignación, responseMap, slot y contenido: solo lo obligatorio', () => {
    expect((add('/variables').variables as unknown[]).at(-1)).toEqual({ name: '', type: 'string' });
    expect(((add(`/nodes/${NODE['pedir-tamano']}/choices`).nodes as Record<string, unknown>[])[NODE['pedir-tamano']!]!.choices as unknown[]).at(-1)).toEqual({ id: 'opcion-1', label: '' });
    expect((nodeAt(add(`/nodes/${NODE['ruta-segmento']}/rules`), 'ruta-segmento').rules as unknown[]).at(-1)).toEqual({ when: { variable: '', op: 'eq' } });
    expect((nodeAt(add(`/nodes/${NODE['marcar-pyme']}/assignments`), 'marcar-pyme').assignments as unknown[]).at(-1)).toEqual({ variable: '', value: '' });
    expect((nodeAt(add(`/nodes/${NODE['enviar-crm']}/responseMap`), 'enviar-crm').responseMap as unknown[]).at(-1)).toEqual({ variable: '', pointer: '' });
    expect((nodeAt(add(`/nodes/${NODE['bienvenida']}/content`), 'bienvenida').content as unknown[]).at(-1)).toEqual({ kind: 'text', text: '' });
    const faq = clone('faq-ia');
    expect(((add('/nodes/1/slots', faq).nodes as Record<string, unknown>[])[1]!.slots as unknown[]).at(-1)).toEqual({ variable: '', description: '' });
  });

  it('el id de una opción nueva es opcion-<n> con el menor n libre', () => {
    const first = add(`/nodes/${NODE['pedir-tamano']}/choices`);
    const again = run(
      addItem(`/nodes/${NODE['pedir-tamano']}/choices`, fieldsOfType('input')!.find((field) => field.key === 'choices')!),
      first,
      CAPTACION,
    );
    const ids = ((again.nodes as Record<string, unknown>[])[NODE['pedir-tamano']!]!.choices as { id: string }[]).map((choice) => choice.id);
    expect(ids.slice(-2)).toEqual(['opcion-1', 'opcion-2']);
  });

  it('crea la lista que falta con kindAt del descriptor (slots de un llm sin slots)', () => {
    const flow = clone('faq-ia');
    delete (flow.nodes as Record<string, unknown>[])[1]!.slots;
    const added = add('/nodes/1/slots', flow);
    expect(Array.isArray((added.nodes as Record<string, unknown>[])[1]!.slots)).toBe(true);
  });
});

describe('contenido', () => {
  const base = `/nodes/${NODE['bienvenida']}/content/0`;

  it('de texto a multimedia sustituye el elemento en su sitio, y al revés', () => {
    const image = run(setContentKind(base, 'image'));
    expect(nodeAt(image, 'bienvenida').content).toEqual([{ kind: 'image', url: '' }]);
    const back = run(setContentKind(base, 'text'), image, CAPTACION);
    expect(nodeAt(back, 'bienvenida').content).toEqual([{ kind: 'text', text: '' }]);
  });

  it('entre tipos multimedia solo cambia el kind', () => {
    const image = run(setContentKind(base, 'image'));
    const withAlt = run(writeText(`${base}/alt`, 'Logo', false), image, CAPTACION);
    const video = run(setContentKind(base, 'video'), withAlt, CAPTACION);
    expect(nodeAt(video, 'bienvenida').content).toEqual([{ kind: 'video', url: '', alt: 'Logo' }]);
  });

  it('texto a texto no cambia nada', () => {
    const flow = run(setContentKind(base, 'text'));
    expect(text(flow)).toBe(text(CAPTACION));
  });
});

describe('cabeceras', () => {
  const headers = `/nodes/${NODE['enviar-crm']}/request/headers`;
  const headersOf = (flow: FlowDoc) => (nodeAt(flow, 'enviar-crm').request as { headers: Record<string, unknown> }).headers;

  it('añadir como secreto escribe solo el nombre, al final', () => {
    const changed = run(addHeader(headers, 'X-Api-Key', 'secret', 'SOPORTE_TOKEN'));
    expect(text(headersOf(changed))).toBe('{"Authorization":{"secret":"CRM_TOKEN"},"Content-Type":"application/json","X-Api-Key":{"secret":"SOPORTE_TOKEN"}}');
  });

  it('cambiar de secreto a texto escribe "" en su sitio, y de texto a secreto el nombre', () => {
    const asText = run(writeHeader(headers, 'Authorization', 'text', ''));
    expect(text(headersOf(asText))).toBe('{"Authorization":"","Content-Type":"application/json"}');
    const asSecret = run(writeHeader(headers, 'Content-Type', 'secret', 'OTRO'));
    expect(text(headersOf(asSecret))).toBe('{"Authorization":{"secret":"CRM_TOKEN"},"Content-Type":{"secret":"OTRO"}}');
  });

  it('renombrar la cambia en su sitio; un nombre repetido o vacío no cambia nada', () => {
    const renamed = run(renameHeader(headers, 'Authorization', 'X-Auth'));
    expect(Object.keys(headersOf(renamed))).toEqual(['X-Auth', 'Content-Type']);
    expect(renameHeader(headers, 'Authorization', 'Content-Type')(structuredClone(CAPTACION), CAPTACION)).toEqual({ ok: false, error: 'Ya hay una cabecera con ese nombre.' });
    expect(addHeader(headers, 'Content-Type', 'text', 'x')(structuredClone(CAPTACION), CAPTACION)).toEqual({ ok: false, error: 'Ya hay una cabecera con ese nombre.' });
    expect(addHeader(headers, '', 'text', 'x')(structuredClone(CAPTACION), CAPTACION).ok).toBe(false);
    expect(renameHeader(headers, 'Authorization', '')(structuredClone(CAPTACION), CAPTACION).ok).toBe(false);
  });

  it('nombres con / , ~ , -, 10 y __proto__ se escriben, renombran y quitan por su puntero escapado', () => {
    for (const name of ['a/b', 'x~y', '-', '10', '__proto__']) {
      const added = run(addHeader(headers, name, 'text', 'v'));
      // Las claves como "10" van las primeras en JavaScript: el orden lo fija el motor, no el editor.
      expect(Object.keys(headersOf(added))).toContain(name);
      expect(headersOf(added)[name]).toBe('v');
      const edited = run(writeHeader(headers, name, 'text', 'w'), added, CAPTACION);
      expect(headersOf(edited)[name]).toBe('w');
      expect(text(run(removeHeader(headers, name), edited, CAPTACION))).toBe(text(CAPTACION));
    }
  });

  it('una cabecera llamada - en un request sin headers crea un objeto y no una lista', () => {
    const flow = clone('captacion-leads');
    delete (nodeAt(flow, 'enviar-crm').request as Record<string, unknown>).headers;
    const changed = run(addHeader(headers, '-', 'text', 'v'), flow, flow);
    expect(headersOf(changed)).toEqual({ '-': 'v' });
    expect(Array.isArray(headersOf(changed))).toBe(false);
  });

  it('la primera cabecera de un request sin headers crea headers al final de request', () => {
    const flow = clone('captacion-leads');
    delete (nodeAt(flow, 'enviar-crm').request as Record<string, unknown>).headers;
    const changed = run(addHeader(headers, 'X-A', 'text', 'v'), flow, flow);
    expect(Object.keys(nodeAt(changed, 'enviar-crm').request as object)).toEqual(['method', 'url', 'body', 'headers']);
  });
});
