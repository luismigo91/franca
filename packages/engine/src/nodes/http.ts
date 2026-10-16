import { DEFAULT_HTTP_RETRIES, MAX_EXTERNAL_CALLS_PER_ADVANCE, type HttpErrorReason } from '../constants.js';
import { invokeHost, readHttpCapability } from '../http/capability.js';
import { checkHttpConfig } from '../http/config.js';
import { prepareRequest, requestFor } from '../http/request.js';
import { mapResponse } from '../http/response-map.js';
import { readAttemptResult } from '../http/result.js';
import { judgeAttempt, type Verdict } from '../http/retry.js';
import { ValueTooLargeError } from '../template.js';
import { VALUE_TOO_LARGE } from './message.js';
import type { NodeExecutor, StepOutcome } from './types.js';
import { executeUnsupported } from './unsupported.js';

const fail = (code: 'invalid_http_config' | 'missing_secret' | 'http_host_error' | 'http_limit_exceeded', message: string): StepOutcome => ({
  kind: 'fail',
  code,
  message,
});

const HOST_ERROR = fail('http_host_error', 'la capacidad http del host falló o devolvió un resultado fuera de contrato');

/**
 * Ejecuta un nodo `http`, en el orden de la spec: capacidad del host, configuración, textos
 * renderizados y petición construida, y por último los intentos (cada uno tras reservar una
 * llamada del presupuesto compartido). Un fallo de sesión nunca emite el evento `http`; un error
 * de la llamada lo emite y sigue por `onError`.
 *
 * Los mensajes de error son textos fijos: nunca incluyen la URL, cabeceras, body, respuesta ni
 * nada de lo que lance o devuelva el host.
 */
export const executeHttp: NodeExecutor<'http'> = async (node, ctx) => {
  const capability = readHttpCapability(ctx.host);
  if (capability.kind === 'absent') return executeUnsupported(node);
  if (capability.kind === 'error') return HOST_ERROR;
  const configError = checkHttpConfig(node);
  if (configError !== null) return fail('invalid_http_config', configError);

  let prepared;
  try {
    prepared = prepareRequest(node, (name) => ctx.vars.get(name), ctx.piiVariables);
  } catch (error) {
    if (error instanceof ValueTooLargeError) return VALUE_TOO_LARGE;
    throw error;
  }

  const finish = (attempts: number, status: number | null, error: HttpErrorReason | null): StepOutcome => {
    ctx.emit({ type: 'http', nodeId: node.id, attempts, status, error });
    return { kind: 'next', nodeId: error === null ? node.next : node.onError };
  };
  if (!prepared.ok) return finish(0, null, prepared.reason);

  const maxAttempts = 1 + (node.retries ?? DEFAULT_HTTP_RETRIES);
  let attempts = 0;
  let last: Extract<Verdict, { ok: false }> | undefined;
  while (attempts < maxAttempts) {
    if (!ctx.reserveExternalCall()) {
      // Un reintento que no cabe se recorta; un primer intento que no cabe es un ciclo (fallo visible).
      if (attempts === 0) return fail('http_limit_exceeded', `se superó el límite de ${MAX_EXTERNAL_CALLS_PER_ADVANCE} llamadas externas por avance`);
      break;
    }
    attempts++;
    const called = await invokeHost(capability.call, ctx.host, requestFor(prepared.request, attempts));
    if (!called.ok) return HOST_ERROR;
    const result = readAttemptResult(called.value);
    if (result === null) return HOST_ERROR;
    if (result.kind === 'missing_secret') {
      return fail('missing_secret', 'el host no tiene un secreto que pide el nodo o no puede enviarlo a ese destino');
    }
    const verdict = judgeAttempt(result, node.request.method);
    if (verdict.ok) {
      const entries = node.responseMap ?? [];
      if (entries.length === 0) return finish(attempts, verdict.status, null);
      const mapped = mapResponse(verdict.body, entries);
      // Todo o nada: solo se asigna si todas las entradas se pueden guardar.
      if (!mapped.ok) return finish(attempts, verdict.status, 'invalid_response');
      for (const [variable, value] of mapped.assignments) ctx.vars.set(variable, value);
      return finish(attempts, verdict.status, null);
    }
    last = verdict;
    if (!verdict.retryable) break;
  }
  // Con al menos un intento hecho, `last` está definido: el bucle solo sale sin él si no reservó ninguno y eso devuelve antes.
  return finish(attempts, last!.status, last!.reason);
};
