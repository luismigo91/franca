import type { Flow } from '@franca/spec';
import { SESSION_ERROR_CODES, STATE_VERSION } from './constants.js';
import { cloneJsonStrict } from './json.js';
import type { SessionError, SessionState, SessionStatus, VariableValue } from './types.js';
import type { VariableStore } from './variables.js';

/**
 * Construye el estado de una sesión detenida.
 *
 * @param flow Flujo ejecutado (forma JSON).
 * @param vars Variables al detenerse.
 * @param stop Dónde y por qué se detuvo.
 * @returns Un estado JSON puro, sin referencias al flujo ni al almacén.
 */
export function buildState(
  flow: Flow,
  vars: VariableStore,
  stop: {
    status: SessionStatus;
    nodeId: string;
    outcome: string | null;
    error: SessionError | null;
    /** Solo en la parada `waiting`. */
    attempt?: number;
  },
): SessionState {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    stateVersion: STATE_VERSION,
    flowId: flow.id,
    status: stop.status,
    nodeId: stop.nodeId,
    variables: copy(vars.sessionVariables()),
    contact: copy(vars.contactVariables()),
    outcome: stop.outcome,
    error: stop.error,
    ...(stop.attempt === undefined ? {} : { attempt: stop.attempt }),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Lee un estado recibido del host.
 *
 * @param input Valor sin tipar.
 * @returns Una copia del estado, o `null` si no cumple la forma de `SessionState`, su versión es
 *   desconocida, es incoherente (`status`/`outcome`/`error`) o contiene valores que no son JSON.
 */
export function parseState(input: unknown): SessionState | null {
  const json = cloneJsonStrict(input);
  if (!json.ok || !isRecord(json.value)) return null;
  const s = json.value;
  if (s.stateVersion !== STATE_VERSION) return null;
  if (typeof s.flowId !== 'string' || typeof s.nodeId !== 'string') return null;
  if (s.status !== 'ended' && s.status !== 'failed' && s.status !== 'waiting') return null;
  if (!isRecord(s.variables) || !Object.values(s.variables).every((v) => v !== null)) return null;
  if (!isRecord(s.contact)) return null;
  const error = parseError(s.error);
  if (error === undefined) return null;
  if (s.outcome !== null && typeof s.outcome !== 'string') return null;
  if (s.status === 'ended' && error !== null) return null;
  if (s.status === 'failed' && (error === null || s.outcome !== null)) return null;
  const waiting = s.status === 'waiting';
  if (waiting && (error !== null || s.outcome !== null || !isAttempt(s.attempt))) return null;
  return {
    stateVersion: STATE_VERSION,
    flowId: s.flowId,
    status: s.status,
    nodeId: s.nodeId,
    variables: s.variables as Record<string, VariableValue>,
    contact: s.contact as Record<string, VariableValue | null>,
    outcome: s.outcome,
    error,
    ...(waiting ? { attempt: s.attempt as number } : {}),
  };
}

const isAttempt = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

/** @returns El error, `null` si no hay, `undefined` si la forma es inválida. */
function parseError(value: unknown): SessionError | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.nodeId !== 'string') return undefined;
  const code = SESSION_ERROR_CODES.find((c) => c === value.code);
  return code ? { code, nodeId: value.nodeId } : undefined;
}
