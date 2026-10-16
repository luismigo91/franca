import type { Rule } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { deepEqual } from '../../src/json.js';
import { evaluatePredicate, evaluateRule, InvalidRuleError } from '../../src/predicates.js';
import { renderTemplate, textOf } from '../../src/template.js';
import type { VariableValue } from '../../src/types.js';

const NONE = Symbol('sin valor');
type Input = VariableValue | typeof NONE;

/** Evalúa `v op value`; sin `value` en los argumentos = regla sin la propiedad `value`. */
function ev(variable: Input, op: Rule['op'], ...value: [unknown?]): boolean {
  const rule: Rule = { variable: 'v', op };
  if (value.length) rule.value = value[0];
  return evaluateRule(rule, (name) => (name === 'v' && variable !== NONE ? variable : undefined));
}

describe('eq: igualdad estructural exige el mismo tamaño', () => {
  it('un array más largo o más corto nunca es igual', () => {
    expect(ev([1], 'eq', [1, 2])).toBe(false);
    expect(ev([1, 2], 'eq', [1])).toBe(false);
    expect(ev([], 'eq', [[]])).toBe(false);
    expect(ev([[1]], 'eq', [[1, 2]])).toBe(false);
  });

  it('un objeto con claves de más o de menos nunca es igual', () => {
    expect(ev({ a: 1 }, 'eq', { a: 1, b: 2 })).toBe(false);
    expect(ev({ a: 1, b: 2 }, 'eq', { a: 1 })).toBe(false);
    expect(ev({ a: { b: 1 } }, 'eq', { a: { b: 1, c: null } })).toBe(false);
  });

  it('null dentro de una estructura no equivale a clave ausente', () => {
    expect(ev({ a: null }, 'eq', {})).toBe(false);
    expect(ev({ a: null }, 'eq', { b: null })).toBe(false);
    expect(ev({ a: null }, 'eq', { a: null })).toBe(true);
    expect(ev([null], 'eq', [null])).toBe(true);
    expect(ev([null], 'eq', [])).toBe(false);
  });

  it('un array y un objeto con las mismas "claves" no son iguales', () => {
    expect(ev({ a: 1 }, 'eq', [1])).toBe(false);
    expect(ev([1], 'eq', { 0: 1 })).toBe(false);
    expect(ev([], 'eq', {})).toBe(false);
    expect(ev({}, 'eq', [])).toBe(false);
  });

  it('claves heredadas de Object no cuentan como presentes (__proto__ propia)', () => {
    const a = JSON.parse('{"__proto__":1}') as VariableValue;
    expect(ev(a, 'eq', JSON.parse('{"__proto__":1}'))).toBe(true);
    expect(ev(a, 'eq', { toString: 1 })).toBe(false);
    expect(ev({ toString: 1 }, 'eq', a as never)).toBe(false);
    expect(deepEqual(JSON.parse('{"__proto__":1}'), JSON.parse('{"constructor":1}'))).toBe(false);
  });

  it('un array o un objeto frente a un escalar nunca es igual', () => {
    expect(ev([], 'eq', '')).toBe(false);
    expect(ev({}, 'eq', 'true')).toBe(false);
    expect(ev(['1'], 'eq', '1')).toBe(false);
    expect(ev([1], 'eq', 1)).toBe(false);
    expect(ev('1', 'eq', [1])).toBe(false);
    expect(ev(true, 'eq', [true])).toBe(false);
  });
});

describe('eq: coerción entre tipos mezclados', () => {
  it.each([
    [0, false, false],
    ['0', false, false],
    [1, true, false],
    ['1', true, false],
    [' true ', true, false],
    ['TRUE', true, false],
    ['True', true, false],
    ['true', true, true],
    ['false', false, true],
    [true, 'true', true],
    [false, 'true', false],
    [true, 'false', false],
    [true, 'TRUE', false],
    ['', false, false],
  ] as [Input, unknown, boolean][])('%j eq %j → %j', (variable, value, expected) => {
    expect(ev(variable, 'eq', value)).toBe(expected);
    expect(ev(variable, 'neq', value)).toBe(!expected);
  });

  it.each([
    [1, '1.0', true],
    ['1', 1, true],
    ['1', '1.0', false],
    [-0, 0, true],
    ['-0', 0, true],
    [0, '-0', true],
    [0.30000000000000004, 0.3, false],
    [1e308, '1e308', true],
    ['1e400', 1e308, false],
    ['abc', 5, false],
    [5, 'abc', false],
    [5, '', false],
    [0, '', false],
    ['  7  ', 7, true],
    ['\n7\t', 7, true],
    ['7 7', 7, false],
    ['+7', 7, false],
    ['07', 7, false],
    ['.5', 0.5, false],
    ['5.', 5, false],
    ['0x10', 16, false],
    ['Infinity', Infinity, false],
  ] as [Input, unknown, boolean][])('número y string numérico: %j eq %j → %j', (variable, value, expected) => {
    expect(ev(variable, 'eq', value)).toBe(expected);
  });

  it('una variable sin valor solo es igual a null', () => {
    expect(ev(NONE, 'eq', null)).toBe(true);
    for (const value of ['', 0, false, [], {}, 'null']) expect(ev(NONE, 'eq', value)).toBe(false);
    for (const value of ['', 0, false, [], {}]) expect(ev(NONE, 'neq', value)).toBe(true);
    expect(ev(NONE, 'neq', null)).toBe(false);
  });

  it('una variable con valor nunca es igual a null', () => {
    for (const variable of ['', 0, false, [], {}, 'null', [null]] as VariableValue[]) {
      expect(ev(variable, 'eq', null)).toBe(false);
      expect(ev(variable, 'neq', null)).toBe(true);
    }
  });
});

describe('contains y startsWith en tipos mezclados', () => {
  it('array: algún elemento eq a value, con la coerción de eq', () => {
    expect(ev(['true'], 'contains', true)).toBe(true);
    expect(ev([true], 'contains', 'true')).toBe(true);
    expect(ev([{ a: 1 }], 'contains', { a: 1 })).toBe(true);
    expect(ev([{ a: 1 }], 'contains', { a: 1, b: 2 })).toBe(false);
    expect(ev([[1, 2]], 'contains', [1, 2])).toBe(true);
    expect(ev([[1, 2]], 'contains', [1])).toBe(false);
    expect(ev([[1, 2]], 'contains', 1)).toBe(false);
    expect(ev([1, 2], 'contains', 3)).toBe(false);
    expect(ev([], 'contains', '')).toBe(false);
    expect(ev([''], 'contains', '')).toBe(true);
  });

  it('array: un elemento null equivale a "sin valor" y solo coincide con value null', () => {
    expect(ev([null], 'contains', null)).toBe(true);
    expect(ev([null], 'contains', '')).toBe(false);
    expect(ev([null], 'contains', 'null')).toBe(false);
    expect(ev([''], 'contains', null)).toBe(false);
    expect(ev([0], 'contains', null)).toBe(false);
  });

  it('array: startsWith siempre es falso', () => {
    expect(ev(['a'], 'startsWith', 'a')).toBe(false);
    expect(ev([], 'startsWith', '')).toBe(false);
    expect(ev(['a'], 'startsWith', ['a'])).toBe(false);
  });

  it('escalares: opera sobre la forma textual de ambos lados', () => {
    expect(ev('a1b', 'contains', 1)).toBe(true);
    expect(ev('a true', 'contains', true)).toBe(true);
    expect(ev(12345, 'contains', 34)).toBe(true);
    expect(ev(12345, 'startsWith', 123)).toBe(true);
    expect(ev(12345, 'startsWith', 23)).toBe(false);
    expect(ev(1e21, 'contains', '1e+21')).toBe(true);
    expect(ev(false, 'contains', 'als')).toBe(true);
    expect(ev(true, 'startsWith', 'tr')).toBe(true);
    expect(ev(-0, 'contains', '-')).toBe(false);
    expect(ev(1.5, 'contains', '.')).toBe(true);
  });

  it('escalares: distingue mayúsculas y un value vacío da verdadero', () => {
    expect(ev('TRUE', 'contains', true)).toBe(false);
    expect(ev('abc', 'startsWith', '')).toBe(true);
    expect(ev('', 'contains', '')).toBe(true);
    expect(ev('', 'startsWith', 'a')).toBe(false);
    expect(ev(0, 'contains', '')).toBe(true);
    expect(ev(false, 'startsWith', '')).toBe(true);
  });

  it('value null, array u objeto sobre un escalar es falso, también en startsWith', () => {
    for (const op of ['contains', 'startsWith'] as const) {
      expect(ev('abc', op, null)).toBe(false);
      expect(ev('abc', op, ['a'])).toBe(false);
      expect(ev('abc', op, { a: 1 })).toBe(false);
      expect(ev(NONE, op, '')).toBe(false);
      expect(ev({ a: 1 }, op, 'a')).toBe(false);
      expect(ev({}, op, '')).toBe(false);
    }
  });

  it('compara unidades de código: un par sustituto es una subcadena de sí mismo, no de sus mitades', () => {
    expect(ev('a😀b', 'contains', '😀')).toBe(true);
    expect(ev('😀', 'startsWith', '\ud83d')).toBe(true);
    expect(ev('😀', 'contains', '\ude00')).toBe(true);
  });
});

describe('Operadores de orden en tipos mezclados', () => {
  it('compara strings por unidades de código, no por code point ni por locale', () => {
    expect(ev('😀', 'gt', '￿')).toBe(false);
    expect(ev('😀', 'lt', '￿')).toBe(true);
    expect(ev('B', 'lt', 'a')).toBe(true);
    expect(ev('Z', 'lt', 'a')).toBe(true);
    expect(ev('é', 'gt', 'z')).toBe(true);
    expect(ev('', 'lt', 'a')).toBe(true);
    expect(ev('a', 'gte', 'a')).toBe(true);
    expect(ev('a', 'gt', 'a')).toBe(false);
    expect(ev('abc', 'lt', 'abd')).toBe(true);
    expect(ev('ab', 'lt', 'abc')).toBe(true);
  });

  it('si solo uno de los strings es numérico, se comparan como texto', () => {
    expect(ev('10', 'gt', '9a')).toBe(false);
    expect(ev('10', 'lt', '9a')).toBe(true);
    expect(ev('10', 'gt', '9')).toBe(true);
    expect(ev('abc', 'gt', '5')).toBe(true);
  });

  it('un number frente a un string no numérico o vacío no se ordena', () => {
    for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
      expect(ev(5, op, '')).toBe(false);
      expect(ev(5, op, 'abc')).toBe(false);
      expect(ev('abc', op, 5)).toBe(false);
      expect(ev('', op, 0)).toBe(false);
    }
  });

  it('boolean, array, objeto, sin valor y value null no se ordenan', () => {
    for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
      expect(ev(true, op, false)).toBe(false);
      expect(ev(true, op, true)).toBe(false);
      expect(ev([5], op, 1)).toBe(false);
      expect(ev([5], op, [1])).toBe(false);
      expect(ev({ a: 1 }, op, 1)).toBe(false);
      expect(ev(5, op, null)).toBe(false);
      expect(ev(5, op, [1])).toBe(false);
      expect(ev(5, op, true)).toBe(false);
      expect(ev('5', op, true)).toBe(false);
      expect(ev(NONE, op, 0)).toBe(false);
      expect(ev(NONE, op, null)).toBe(false);
    }
  });

  it('gte y lte incluyen la igualdad numérica entre formas distintas', () => {
    expect(ev(' 5 ', 'gte', 5)).toBe(true);
    expect(ev('5.0', 'lte', '5')).toBe(true);
    expect(ev('5.0', 'gt', '5')).toBe(false);
    expect(ev(-0, 'lte', 0)).toBe(true);
    expect(ev(-0, 'lt', 0)).toBe(false);
    expect(ev('-1', 'lt', '-0.5')).toBe(true);
    expect(ev('1e2', 'gt', 99)).toBe(true);
  });

  it('números en los extremos de double no se desbordan al restar', () => {
    expect(ev(1e308, 'gt', -1e308)).toBe(true);
    expect(ev(-1e308, 'lt', 1e308)).toBe(true);
    expect(ev(Number.MIN_VALUE, 'gt', 0)).toBe(true);
    expect(ev(Number.MAX_SAFE_INTEGER, 'gt', Number.MAX_SAFE_INTEGER - 1)).toBe(true);
    expect(ev(Number.MAX_SAFE_INTEGER, 'lt', Number.MAX_SAFE_INTEGER - 1)).toBe(false);
  });
});

describe('isEmpty e isSet en valores límite', () => {
  it('solo espacios en blanco de cualquier tipo habitual', () => {
    for (const blank of [' ', '\t', '\n', '\r\n', ' \t\n ', '\u00a0', '\u2003']) expect(ev(blank, 'isEmpty')).toBe(true);
    expect(ev(' a ', 'isEmpty')).toBe(false);
    expect(ev('0', 'isEmpty')).toBe(false);
  });

  it('un array con elementos null o un objeto con claves null no está vacío', () => {
    expect(ev([null], 'isEmpty')).toBe(false);
    expect(ev([[]], 'isEmpty')).toBe(false);
    expect(ev({ a: null }, 'isEmpty')).toBe(false);
    expect(ev({ a: {} }, 'isEmpty')).toBe(false);
  });

  it('0, false y NaN-like no están vacíos; todo lo que tiene valor está "set"', () => {
    expect(ev(0, 'isEmpty')).toBe(false);
    expect(ev(false, 'isEmpty')).toBe(false);
    for (const v of ['', 0, false, [], {}, '   '] as VariableValue[]) expect(ev(v, 'isSet')).toBe(true);
    expect(ev(NONE, 'isSet')).toBe(false);
    expect(ev(NONE, 'isEmpty')).toBe(true);
  });

  it('ignoran value sea cual sea su tipo', () => {
    for (const value of [false, null, 0, '', [], {}, 'x']) {
      expect(ev('Ana', 'isSet', value)).toBe(true);
      expect(ev('Ana', 'isEmpty', value)).toBe(false);
      expect(ev(NONE, 'isSet', value)).toBe(false);
      expect(ev(NONE, 'isEmpty', value)).toBe(true);
    }
  });
});

describe('matches sobre tipos mezclados', () => {
  it('opera sobre la forma textual de number y boolean', () => {
    expect(ev(1e21, 'matches', '^1e\\+21$')).toBe(true);
    expect(ev(1e-7, 'matches', '^1e-7$')).toBe(true);
    expect(ev(-0, 'matches', '^0$')).toBe(true);
    expect(ev(true, 'matches', '^true$')).toBe(true);
    expect(ev(false, 'matches', '^f')).toBe(true);
    expect(ev(1500.5, 'matches', '^\\d+\\.\\d$')).toBe(true);
  });

  it('array, objeto y sin valor dan falso, aunque el patrón coincidiría con su JSON', () => {
    expect(ev(['a'], 'matches', 'a')).toBe(false);
    expect(ev(['a'], 'matches', '.*')).toBe(false);
    expect(ev({ a: 1 }, 'matches', 'a')).toBe(false);
    expect(ev([], 'matches', '^\\[\\]$')).toBe(false);
    expect(ev(NONE, 'matches', '.*')).toBe(false);
  });

  it('un patrón roto falla aunque la variable no tenga valor o sea un array', () => {
    for (const input of [NONE, ['a'], { a: 1 }, 'x'] as Input[]) {
      expect(() => ev(input, 'matches', '(')).toThrow(InvalidRuleError);
      expect(() => ev(input, 'matches', '(a)\\1')).toThrow(InvalidRuleError);
    }
  });

  it('un value que no es string falla aunque la variable no tenga valor', () => {
    for (const value of [null, 5, true, ['a'], { a: 1 }]) {
      expect(() => ev(NONE, 'matches', value)).toThrow(InvalidRuleError);
      expect(() => ev('a', 'matches', value)).toThrow(InvalidRuleError);
    }
    expect(() => ev('a', 'matches')).toThrow(InvalidRuleError);
  });
});

describe('all y any en los extremos', () => {
  const lookup = (name: string): VariableValue | undefined => (name === 'v' ? 1 : undefined);
  const yes: Rule = { variable: 'v', op: 'eq', value: 1 };
  const no: Rule = { variable: 'v', op: 'eq', value: 2 };
  const broken: Rule = { variable: 'v', op: 'eq' };

  it('any se detiene en el primer verdadero y all en el primer falso, aunque haya reglas rotas detrás', () => {
    expect(evaluatePredicate({ any: [yes, broken] }, lookup)).toBe(true);
    expect(evaluatePredicate({ all: [no, broken] }, lookup)).toBe(false);
    expect(evaluatePredicate({ any: [{ all: [no, broken] }, yes, broken] }, lookup)).toBe(true);
  });

  it('una regla rota que sí se llega a evaluar falla, también anidada', () => {
    expect(() => evaluatePredicate({ all: [yes, broken] }, lookup)).toThrow(InvalidRuleError);
    expect(() => evaluatePredicate({ any: [no, broken] }, lookup)).toThrow(InvalidRuleError);
    expect(() => evaluatePredicate({ any: [no, { all: [yes, { any: [no, broken] }] }] }, lookup)).toThrow(
      InvalidRuleError,
    );
  });

  it('las reglas de un all/any se evalúan en el orden del array', () => {
    const seen: string[] = [];
    const spy = (name: string): VariableValue | undefined => {
      seen.push(name);
      return 1;
    };
    evaluatePredicate(
      {
        all: [
          { variable: 'a', op: 'isSet' },
          { any: [{ variable: 'b', op: 'eq', value: 9 }, { variable: 'c', op: 'isSet' }, { variable: 'd', op: 'isSet' }] },
          { variable: 'e', op: 'isSet' },
        ],
      },
      spy,
    );
    expect(seen).toEqual(['a', 'b', 'c', 'e']);
  });
});

describe('Plantillas con valores no string y marcadores límite', () => {
  const vars = (values: Record<string, VariableValue>) => (name: string) =>
    Object.hasOwn(values, name) ? values[name] : undefined;

  it('forma textual de números extremos y de -0', () => {
    expect(textOf(1e21)).toBe('1e+21');
    expect(textOf(1e-7)).toBe('1e-7');
    expect(textOf(-0)).toBe('0');
    expect(textOf(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(textOf(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
  });

  it('arrays y objetos anidados con null, strings con comillas y unicode', () => {
    expect(textOf({ a: null, b: [null, 'x"y', '😀'], c: {} })).toBe('{"a":null,"b":[null,"x\\"y","😀"],"c":{}}');
    expect(textOf([])).toBe('[]');
    expect(textOf({})).toBe('{}');
    expect(textOf('')).toBe('');
  });

  it('los marcadores adyacentes y las llaves de más', () => {
    const v = vars({ a: 'A', b: 'B' });
    expect(renderTemplate('{{a}}{{b}}', v)).toBe('AB');
    expect(renderTemplate('{{{a}}}', v)).toBe('{A}');
    expect(renderTemplate('{{a}}}', v)).toBe('A}');
    expect(renderTemplate('{{{{a}}}}', v)).toBe('{{A}}');
    expect(renderTemplate('{{\na\n}}', v)).toBe('A');
    expect(renderTemplate('{{ a b }}', v)).toBe('{{ a b }}');
    expect(renderTemplate('{{}}', v)).toBe('{{}}');
    expect(renderTemplate('{{a}', v)).toBe('{{a}');
    expect(renderTemplate('{a}}', v)).toBe('{a}}');
    expect(renderTemplate('{{a-b}} {{ $a }} {{é}}', v)).toBe('{{a-b}} {{ $a }} {{é}}');
  });

  it('distingue mayúsculas en el nombre de variable', () => {
    expect(renderTemplate('{{a}}|{{A}}', vars({ a: 'min' }))).toBe('min|');
  });

  it('los patrones de reemplazo de String.replace no se interpretan en los valores', () => {
    expect(renderTemplate('{{d}}', vars({ d: '$& $1 $$ $` $\'' }))).toBe('$& $1 $$ $` $\'');
    expect(renderTemplate('{{o}}', vars({ o: { k: ['$&'] } }))).toBe('{"k":["$&"]}');
  });

  it('un valor con marcadores dentro de un array u objeto tampoco se expande', () => {
    expect(renderTemplate('{{o}}', vars({ o: ['{{a}}'], a: 'A' }))).toBe('["{{a}}"]');
  });

  it('nombres como constructor o __proto__ sin valor dan cadena vacía', () => {
    const empty = (): undefined => undefined;
    expect(renderTemplate('[{{constructor}}{{__proto__}}{{toString}}{{hasOwnProperty}}]', empty)).toBe('[]');
  });
});
