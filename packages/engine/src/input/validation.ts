import type { InputNode } from '@franca/spec';
import { MAX_INPUT_LENGTH } from '../constants.js';
import type { Program } from '../regex/compile.js';
import { compilePattern } from '../regex/compile.js';
import { PatternError } from '../regex/parse.js';

export interface AnswerRules {
  readonly min?: number;
  readonly max?: number;
  readonly program: Program | null;
}

export type RulesCheck = { ok: true; rules: AnswerRules } | { ok: false; message: string };

const fail = (detail: string): RulesCheck => ({
  ok: false,
  message: `la validación del nodo no se puede aplicar: ${detail}`,
});

/**
 * Prepara la validación de un input: compila `pattern` con el matcher lineal de `matches` y
 * comprueba que los límites se pueden cumplir. Solo se aplica lo que el tipo usa: `pattern` fuera
 * de `choice`; `min`/`max` en `text`, `number` y `choice` múltiple.
 *
 * @param node Nodo input (forma JSON).
 * @returns Las reglas listas para evaluar respuestas, o el motivo por el que no se pueden aplicar.
 */
export function prepareRules(node: InputNode): RulesCheck {
  const validation = node.validation;
  const isChoice = node.inputType === 'choice';
  const multiple = isChoice && node.multiple === true;
  const limited = node.inputType === 'text' || node.inputType === 'number' || multiple;

  let program: Program | null = null;
  if (!isChoice && validation?.pattern !== undefined) {
    try {
      program = compilePattern(validation.pattern);
    } catch (error) {
      if (error instanceof PatternError) return fail(error.message);
      throw error;
    }
  }
  if (!limited) return { ok: true, rules: { program } };

  const { min, max } = validation ?? {};
  if (min !== undefined && max !== undefined && min > max) return fail('min es mayor que max');
  if (max !== undefined && max < 1 && node.inputType !== 'number') return fail('max no permite ninguna respuesta');
  if (node.inputType === 'text' && min !== undefined && min > MAX_INPUT_LENGTH) return fail('min supera la longitud máxima de una respuesta');
  if (multiple && min !== undefined && min > (node.choices?.length ?? 0)) return fail('min supera el número de opciones');
  return { ok: true, rules: { min, max, program } };
}
