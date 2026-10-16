import { validateFlow } from '@franca/spec';
import type { Flow, FlowIssue, InputNode } from '@franca/spec';
import { MAX_NESTING_DEPTH } from './constants.js';
import { cloneJsonWithinDepth, exceedsDepth, toJsonForm } from './json.js';
import { expectedKey, readUserInput } from './input/user-input.js';
import { resumeInput } from './nodes/input.js';
import { run } from './run.js';
import { parseState } from './state.js';
import type {
  AdvanceResult,
  ContinueSessionRequest,
  EngineHost,
  JsonValue,
  Rejection,
  StartSessionRequest,
} from './types.js';
import { createVariableStore, restoreVariableStore } from './variables.js';

type FlowCheck = { flow: Flow } | { rejection: Rejection };

const invalidFlow = (issues: FlowIssue[]): FlowCheck => ({
  rejection: { ok: false, code: 'invalid_flow', message: 'el flujo no es válido', issues },
});

/** Valida la forma JSON del flujo: lo validado es exactamente lo ejecutado. */
function checkFlow(input: unknown): FlowCheck {
  // Antes de cualquier recursión (stringify, ajv): el límite no depende de la pila disponible.
  if (exceedsDepth(input, MAX_NESTING_DEPTH)) {
    const message = `el flujo supera la profundidad máxima de anidamiento (${MAX_NESTING_DEPTH})`;
    return invalidFlow([{ layer: 'shape', path: '', message }]);
  }
  const result = validateFlow(toJsonForm(input));
  return result.valid ? { flow: result.flow } : invalidFlow(result.issues);
}

type ContactCheck = { values: Map<string, JsonValue> } | { rejection: Rejection };

/**
 * Comprueba y copia los valores de contacto. Solo nombra la clave si es una variable declarada:
 * una clave ajena puede ser cualquier cosa que mande el host.
 */
function checkContact(contact: unknown, flow: Flow): ContactCheck {
  const reject = (message: string): ContactCheck => ({ rejection: { ok: false, code: 'invalid_contact', message } });
  if (contact === undefined || contact === null) return { values: new Map() };
  if (exceedsDepth(contact, MAX_NESTING_DEPTH)) {
    return reject(`los valores de contacto superan la profundidad máxima de anidamiento (${MAX_NESTING_DEPTH})`);
  }
  if (typeof contact !== 'object' || Array.isArray(contact)) return reject('los valores de contacto deben ser un objeto');
  const proto = Object.getPrototypeOf(contact);
  if (proto !== Object.prototype && proto !== null) return reject('los valores de contacto deben ser un objeto plano');
  const declared = new Set((flow.variables ?? []).map((variable) => variable.name));
  const values = new Map<string, JsonValue>();
  for (const key of Object.keys(contact)) {
    const copy = cloneJsonWithinDepth((contact as Record<string, unknown>)[key]);
    if (!copy.ok) {
      return reject(
        declared.has(key)
          ? `el valor de contacto '${key}' no es representable en JSON`
          : 'un valor de contacto no es representable en JSON',
      );
    }
    values.set(key, copy.value);
  }
  return { values };
}

/**
 * Arranca una sesión y la ejecuta hasta que termina o falla.
 *
 * @param request Flujo y valores de contacto opcionales (ambos sin tipar: se validan siempre).
 * @param host Capacidades del host; omitido o `null` equivale a `{}`.
 * @returns El resultado de la sesión, o el rechazo (`invalid_flow`, `invalid_contact`) como valor.
 * @throws Si el flujo es un objeto en memoria que no se puede serializar (ciclos, `bigint`).
 */
export async function startSession(request: StartSessionRequest, host?: EngineHost | null): Promise<AdvanceResult> {
  const checkedFlow = checkFlow(request.flow);
  if ('rejection' in checkedFlow) return checkedFlow.rejection;
  const { flow } = checkedFlow;
  const checkedContact = checkContact(request.contact, flow);
  if ('rejection' in checkedContact) return checkedContact.rejection;
  const vars = createVariableStore(flow.variables, checkedContact.values);
  return run(flow, vars, flow.start, host ?? {});
}

const EXPECTED_SHAPE = {
  text: 'la entrada debe ser {"text": string}',
  choice: 'la entrada debe ser {"choice": id} con el id de una opción del nodo',
  choices: 'la entrada debe ser {"choices": [id, …]} con ids de opciones del nodo, sin repetir',
} as const;

/**
 * Continúa una sesión en espera. Comprueba, en este orden: flujo válido, estado bien formado y de
 * versión conocida, mismo flujo con su nodo presente (y siendo un `input` si espera), sesión en
 * espera y entrada con la forma del nodo. Un rechazo no produce eventos ni estado.
 *
 * @param request Flujo, estado e `input` del usuario (sin tipar).
 * @param host Capacidades del host; omitido o `null` equivale a `{}`.
 * @returns La respuesta evaluada y la ejecución hasta la siguiente detención, o el rechazo como valor.
 * @throws Si el flujo es un objeto en memoria que no se puede serializar (ciclos, `bigint`).
 */
export async function continueSession(request: ContinueSessionRequest, host?: EngineHost | null): Promise<AdvanceResult> {
  const checkedFlow = checkFlow(request.flow);
  if ('rejection' in checkedFlow) return checkedFlow.rejection;
  const { flow } = checkedFlow;
  const state = parseState(request.state);
  if (!state) return { ok: false, code: 'invalid_state', message: 'el estado no es válido o su versión no se reconoce' };
  const node = state.flowId === flow.id ? flow.nodes.find((candidate) => candidate.id === state.nodeId) : undefined;
  if (!node || (state.status === 'waiting' && node.type !== 'input')) {
    return { ok: false, code: 'state_mismatch', message: 'el estado no corresponde a este flujo' };
  }
  if (state.status !== 'waiting' || node.type !== 'input') {
    return { ok: false, code: 'session_not_active', message: 'la sesión no está activa' };
  }
  const input = readUserInput(node, request.input);
  if (!input) return { ok: false, code: 'invalid_input', message: EXPECTED_SHAPE[expectedKey(node)] };
  const vars = restoreVariableStore(flow.variables, state);
  const language = (flow.locale ?? 'es').split('-')[0]!;
  const attempt = state.attempt!;
  return run(flow, vars, node.id, host ?? {}, (ctx) => resumeInput(node, ctx, { attempt, input, language }));
}
