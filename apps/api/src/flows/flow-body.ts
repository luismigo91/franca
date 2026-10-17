import { exceedsFlowDepth, validateFlow, type FlowValidationResult } from '@franca/spec';

export interface InspectedFlowBody {
  /** Lo que da `validateFlow` sobre la forma JSON del cuerpo. */
  verdict: FlowValidationResult;
  /** Lo que se guardaría: el texto de la forma JSON. Ausente si el cuerpo es demasiado profundo. */
  text?: string;
}

/**
 * Valida la forma JSON de un cuerpo: lo validado es exactamente lo guardado. `value` viene de `JSON.parse`, así que
 * `JSON.stringify` siempre da texto; se valida lo que sale de volver a parsearlo (`1e400` se parsea como `Infinity`,
 * que ajv acepta como número, pero tras `stringify` es `null`). Un único `stringify` sirve para validar y guardar.
 * La profundidad se comprueba antes de cualquier recursión: nunca lanza `RangeError`.
 *
 * @param value Valor que dio `JSON.parse` del cuerpo.
 * @returns El veredicto y, si el cuerpo no es demasiado profundo, el texto a guardar.
 */
export function inspectFlowBody(value: unknown): InspectedFlowBody {
  if (exceedsFlowDepth(value)) return { verdict: validateFlow(value) };
  const text = JSON.stringify(value);
  return { verdict: validateFlow(JSON.parse(text)), text };
}
