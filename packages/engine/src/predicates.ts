import type { Predicate, Rule } from '@franca/spec';
import { deepEqual } from './json.js';
import { compilePattern, type Program } from './regex/compile.js';
import { runProgram } from './regex/match.js';
import { PatternError } from './regex/parse.js';
import { textOf } from './template.js';
import type { JsonValue, VariableValue } from './types.js';

/** Una regla no se puede evaluar. La captura solo `condition.ts`, que la convierte en `invalid_rule`. */
export class InvalidRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRuleError';
  }
}

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Lectura numérica: un number, o un string que sin espacios iniciales y finales cumple la
 * gramática de número de JSON y da un valor finito.
 *
 * @param value Valor a leer.
 * @returns El número, o `undefined` si no se puede leer como tal.
 */
export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!JSON_NUMBER.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `eq` de la spec. `variable` es `undefined` si no tiene valor.
 *
 * @param variable Valor de la variable.
 * @param value `value` de la regla.
 * @returns `true` si son iguales según las coerciones de la spec.
 */
export function valuesEqual(variable: VariableValue | undefined, value: JsonValue): boolean {
  if (variable === undefined) return value === null;
  if (value === null) return false;
  if (typeof variable === 'string' && typeof value === 'string') return variable === value;
  if (typeof variable === 'number' || typeof value === 'number') {
    const a = readNumber(variable);
    const b = readNumber(value);
    return a !== undefined && b !== undefined && a === b;
  }
  if (typeof variable === 'boolean' || typeof value === 'boolean') {
    return boolOf(variable) !== undefined && boolOf(variable) === boolOf(value);
  }
  return deepEqual(variable, value);
}

function boolOf(value: JsonValue): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** Operador de orden: `sign` es el signo de `variable - value` (numérico o por unidades de código). */
function order(accepts: (sign: number) => boolean) {
  return (variable: VariableValue | undefined, rule: Rule): boolean => {
    const value = rule.value;
    const a = readNumber(variable);
    const b = readNumber(value);
    if (a !== undefined && b !== undefined) return accepts(Math.sign(a - b));
    if (typeof variable === 'string' && typeof value === 'string') {
      return accepts(variable < value ? -1 : variable > value ? 1 : 0);
    }
    return false;
  };
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function textual(test: (text: string, needle: string) => boolean, allowArray: boolean) {
  return (variable: VariableValue | undefined, rule: Rule): boolean => {
    const value = rule.value as JsonValue;
    if (Array.isArray(variable)) {
      return allowArray && variable.some((item) => valuesEqual(item === null ? undefined : item, value));
    }
    if (!isScalar(variable) || !isScalar(value)) return false;
    return test(textOf(variable), textOf(value));
  };
}

function compileRulePattern(variable: string, pattern: string): Program {
  try {
    return compilePattern(pattern);
  } catch (error) {
    if (error instanceof PatternError) {
      throw new InvalidRuleError(`la regla sobre '${variable}' con el operador 'matches' no es evaluable: ${error.message}`);
    }
    throw error;
  }
}

/** Un evaluador por cada `rule.op`; el tipo obliga a cubrirlos todos. */
export const OPERATORS: { [K in Rule['op']]: (variable: VariableValue | undefined, rule: Rule) => boolean } = {
  eq: (variable, rule) => valuesEqual(variable, rule.value as JsonValue),
  neq: (variable, rule) => !valuesEqual(variable, rule.value as JsonValue),
  gt: order((sign) => sign > 0),
  gte: order((sign) => sign >= 0),
  lt: order((sign) => sign < 0),
  lte: order((sign) => sign <= 0),
  contains: textual((text, needle) => text.includes(needle), true),
  startsWith: textual((text, needle) => text.startsWith(needle), false),
  matches: (variable, rule) => {
    if (typeof rule.value !== 'string') {
      throw new InvalidRuleError(`la regla sobre '${rule.variable}' con el operador 'matches' necesita un value de tipo string`);
    }
    // El patrón se valida siempre, tenga o no valor la variable: un patrón roto no depende de los datos.
    const program = compileRulePattern(rule.variable, rule.value);
    if (variable === undefined || typeof variable === 'object') return false;
    return runProgram(program, textOf(variable));
  },
  isSet: (variable) => variable !== undefined,
  isEmpty: (variable) => {
    if (variable === undefined) return true;
    if (typeof variable === 'string') return variable.trim() === '';
    if (Array.isArray(variable)) return variable.length === 0;
    if (typeof variable === 'object') return Object.keys(variable).length === 0;
    return false;
  },
};

/**
 * Evalúa una regla simple.
 *
 * @param rule Regla (forma JSON).
 * @param lookup Valor actual de una variable, o `undefined` si no tiene.
 * @returns El resultado de la regla.
 * @throws {InvalidRuleError} Si falta `value` en un operador que lo necesita, o `matches` no es evaluable.
 */
export function evaluateRule(rule: Rule, lookup: (name: string) => VariableValue | undefined): boolean {
  if (rule.value === undefined && rule.op !== 'isSet' && rule.op !== 'isEmpty') {
    throw new InvalidRuleError(`la regla sobre '${rule.variable}' con el operador '${rule.op}' necesita value`);
  }
  return OPERATORS[rule.op](lookup(rule.variable), rule);
}

/**
 * Evalúa un predicado de izquierda a derecha con cortocircuito.
 *
 * @param predicate Regla, `all` o `any`.
 * @param lookup Valor actual de una variable, o `undefined` si no tiene.
 * @returns El resultado del predicado.
 * @throws {InvalidRuleError} Si una regla que se llega a evaluar no es evaluable.
 */
export function evaluatePredicate(predicate: Predicate, lookup: (name: string) => VariableValue | undefined): boolean {
  if ('all' in predicate) return predicate.all.every((p) => evaluatePredicate(p, lookup));
  if ('any' in predicate) return predicate.any.some((p) => evaluatePredicate(p, lookup));
  return evaluateRule(predicate, lookup);
}
