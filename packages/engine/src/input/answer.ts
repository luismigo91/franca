import type { InputNode } from '@franca/spec';
import { MAX_INPUT_LENGTH, type InvalidAnswerReason } from '../constants.js';
import { runProgram, type MatchStats } from '../regex/match.js';
import { textOf } from '../template.js';
import type { InputType, VariableValue } from '../types.js';
import { hasUnstorable } from './parsers/chars.js';
import { PARSERS } from './parsers/index.js';
import type { AnswerRules } from './validation.js';

export type AnswerCheck = { ok: true; value: VariableValue } | { ok: false; reason: InvalidAnswerReason };

const invalid = (reason: InvalidAnswerReason): AnswerCheck => ({ ok: false, reason });

/** @returns El número de code points de `text` (un sustituto suelto cuenta 1). */
export function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

const outOfRange = (n: number, { min, max }: AnswerRules): boolean =>
  (min !== undefined && n < min) || (max !== undefined && n > max);

/**
 * Comprueba una respuesta de texto, en este orden: longitud (sobre el texto sin recortar),
 * vacía, formato del tipo, `min`/`max` y `pattern`.
 *
 * @param raw Texto tal como lo envió el usuario.
 * @param inputType Tipo del nodo, distinto de `choice`.
 * @param language Idioma del flujo (parte de `locale` antes del guion).
 * @param rules Reglas preparadas con `prepareRules`.
 * @param stats Contadores opcionales del matcher (para tests).
 * @returns El valor convertido o el motivo del rechazo.
 */
export function checkTextAnswer(
  raw: string,
  inputType: Exclude<InputType, 'choice'>,
  language: string,
  rules: AnswerRules,
  stats?: MatchStats,
): AnswerCheck {
  if (raw.length > MAX_INPUT_LENGTH) return invalid('too_long');
  const text = raw.trim();
  if (text === '') return invalid('required');
  const value = hasUnstorable(text) ? undefined : PARSERS[inputType](text, language);
  if (value === undefined) return invalid('invalid_format');
  if (inputType === 'text' && outOfRange(countCodePoints(text), rules)) return invalid('out_of_range');
  if (inputType === 'number' && outOfRange(value as number, rules)) return invalid('out_of_range');
  if (rules.program && !runProgram(rules.program, textOf(value), stats)) return invalid('pattern_mismatch');
  return { ok: true, value };
}

/**
 * Comprueba una selección múltiple.
 *
 * @param node Nodo input `choice` múltiple.
 * @param options Índices de las opciones elegidas, sin repetir y en el orden del flujo.
 * @param rules Reglas preparadas con `prepareRules`.
 * @returns El array de `value ?? id` o el motivo del rechazo.
 */
export function checkChoices(node: InputNode, options: readonly number[], rules: AnswerRules): AnswerCheck {
  if (options.length === 0) return invalid('required');
  if (outOfRange(options.length, rules)) return invalid('out_of_range');
  const choices = node.choices ?? [];
  return { ok: true, value: options.map((i) => choices[i]!.value ?? choices[i]!.id) };
}
