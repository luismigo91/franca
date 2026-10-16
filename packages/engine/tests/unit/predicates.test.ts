import type { Predicate, Rule } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { evaluatePredicate, evaluateRule, InvalidRuleError, OPERATORS, readNumber } from '../../src/predicates.js';
import type { VariableValue } from '../../src/types.js';

const NONE = Symbol('sin valor');
type Input = VariableValue | typeof NONE;

/** Evalúa `variable op value` con la variable `v` (o sin valor). `value` omitido = sin propiedad `value`. */
function ev(variable: Input, op: Rule['op'], ...value: [unknown?]): boolean {
  const rule: Rule = { variable: 'v', op };
  if (value.length) rule.value = value[0];
  return evaluateRule(rule, (name) => (name === 'v' && variable !== NONE ? variable : undefined));
}

describe('Lectura numérica de valores', () => {
  it('Strings numéricos y no numéricos', () => {
    const results = ['42', ' 42 ', '42.0', '4.2e1', '42abc', '0x2A', ''].map((s) => ev(s, 'eq', 42));
    expect(results).toEqual([true, true, true, true, false, false, false]);
  });

  it('Coma decimal no es número', () => {
    expect(ev('1,5', 'eq', 1.5)).toBe(false);
  });

  it('readNumber: gramática JSON y finitud', () => {
    expect(readNumber(3)).toBe(3);
    expect(readNumber('-0.5')).toBe(-0.5);
    expect(readNumber('1e400')).toBeUndefined();
    for (const bad of ['01', '+1', '.5', '5.', 'Infinity', 'NaN', '1 2', true, null, [], {}, undefined]) {
      expect(readNumber(bad)).toBeUndefined();
    }
  });
});

describe('Operadores eq y neq', () => {
  it('Strings con mayúsculas distintas', () => {
    expect(ev('Pyme', 'eq', 'pyme')).toBe(false);
    expect(ev('Pyme', 'neq', 'pyme')).toBe(true);
  });

  it('Boolean frente a string', () => {
    expect(ev('true', 'eq', true)).toBe(true);
    expect(ev(false, 'eq', 'false')).toBe(true);
    expect(ev('True', 'eq', true)).toBe(false);
  });

  it('Tipos distintos sin coerción', () => {
    expect(ev(true, 'eq', 1)).toBe(false);
    expect(ev(true, 'eq', '1')).toBe(false);
    expect(ev(1, 'eq', true)).toBe(false);
  });

  it('Igualdad estructural', () => {
    const datos = { a: 1, b: [1, 2] };
    expect(ev(datos, 'eq', { b: [1, 2], a: 1 })).toBe(true);
    expect(ev(datos, 'eq', { a: 1, b: [2, 1] })).toBe(false);
  });

  it('Sin coerción dentro de estructuras', () => {
    expect(ev([1, 2], 'eq', ['1', '2'])).toBe(false);
  });

  it('Variable sin valor', () => {
    expect(ev(NONE, 'eq', null)).toBe(true);
    expect(ev(NONE, 'eq', '')).toBe(false);
    expect(ev(NONE, 'neq', 'precio')).toBe(true);
  });

  it('Valor presente frente a null', () => {
    expect(ev('', 'eq', null)).toBe(false);
    expect(ev(0, 'eq', null)).toBe(false);
  });

  it('number y string numérico, y tipos estructurales frente a escalares', () => {
    expect(ev(42, 'eq', '42')).toBe(true);
    expect(ev(42, 'eq', 'abc')).toBe(false);
    expect(ev([1], 'eq', 1)).toBe(false);
    expect(ev('x', 'eq', { a: 1 })).toBe(false);
    expect(ev({ a: 1 }, 'eq', [1])).toBe(false);
  });
});

describe('Operadores de orden gt, gte, lt y lte', () => {
  it('Comparación numérica', () => {
    expect([ev(51, 'gt', 50), ev(51, 'gte', 51), ev(51, 'lt', 51), ev(51, 'lte', 51)]).toEqual([true, true, false, true]);
  });

  it('Strings numéricos se comparan como números', () => {
    expect(ev('10', 'gt', 9)).toBe(true);
    expect(ev('10', 'gt', '9')).toBe(true);
  });

  it('Fechas ISO', () => {
    expect(ev('2026-10-16', 'lt', '2026-11-01')).toBe(true);
    expect(ev('2026-10-16', 'gte', '2026-10-16')).toBe(true);
    expect(ev('b', 'gt', 'a')).toBe(true);
    expect(ev('B', 'gt', 'a')).toBe(false);
  });

  it('String no numérico frente a number', () => {
    expect(ev('abc', 'gt', 5)).toBe(false);
    expect(ev('abc', 'lt', 5)).toBe(false);
  });

  it('Sin valor o tipos no ordenables', () => {
    expect(ev(NONE, 'gt', 0)).toBe(false);
    expect(ev(NONE, 'lt', 0)).toBe(false);
    expect(ev(true, 'gt', false)).toBe(false);
    expect(ev([1], 'gt', 0)).toBe(false);
    expect(ev(5, 'gt', null)).toBe(false);
    expect(ev(5, 'gt', [1])).toBe(false);
  });
});

describe('Operadores contains y startsWith', () => {
  it('Subcadena', () => {
    expect(ev('Precio del envío', 'contains', 'envío')).toBe(true);
    expect(ev('Precio del envío', 'contains', 'precio')).toBe(false);
    expect(ev('Precio del envío', 'startsWith', 'Precio')).toBe(true);
  });

  it('Pertenencia a un array con coerción de eq', () => {
    expect(ev(['a', 'b'], 'contains', 'b')).toBe(true);
    expect(ev([1, 2], 'contains', '2')).toBe(true);
    expect(ev(['a', 'b'], 'startsWith', 'a')).toBe(false);
  });

  it('un null dentro del array cuenta como sin valor', () => {
    expect(ev(['a', null as unknown as string], 'contains', null)).toBe(true);
    expect(ev(['a'], 'contains', null)).toBe(false);
  });

  it('Forma textual de un number y de un boolean', () => {
    expect(ev(28001, 'startsWith', '28')).toBe(true);
    expect(ev(true, 'contains', 'ru')).toBe(true);
    expect(ev('x28', 'contains', 28)).toBe(true);
  });

  it('Value vacío', () => {
    expect(ev('x', 'contains', '')).toBe(true);
    expect(ev('x', 'startsWith', '')).toBe(true);
  });

  it('Casos que dan falso', () => {
    expect(ev({ a: 1 }, 'contains', 'a')).toBe(false);
    expect(ev(NONE, 'contains', 'a')).toBe(false);
    expect(ev('abc', 'contains', { a: 1 })).toBe(false);
    expect(ev('abc', 'contains', null)).toBe(false);
    expect(ev('abc', 'startsWith', ['a'])).toBe(false);
  });
});

describe('Operador matches', () => {
  it('Coincidencia anclada', () => {
    expect(ev('28001', 'matches', '^\\d{5}$')).toBe(true);
    expect(ev('28001', 'matches', '^\\d{4}$')).toBe(false);
  });

  it('Coincidencia parcial y mayúsculas', () => {
    expect(ev('xxABCxx', 'matches', 'ABC')).toBe(true);
    expect(ev('xxABCxx', 'matches', 'abc')).toBe(false);
  });

  it('Modo Unicode', () => {
    expect(ev('😀', 'matches', '^.$')).toBe(true);
  });

  it('Number como texto', () => {
    expect(ev(28001, 'matches', '^28')).toBe(true);
    expect(ev(true, 'matches', '^tr')).toBe(true);
  });

  it('Variable sin valor', () => {
    expect(ev(NONE, 'matches', '.*')).toBe(false);
  });

  it('Array y objeto dan falso', () => {
    expect(ev(['a'], 'matches', '.*')).toBe(false);
    expect(ev({ a: 1 }, 'matches', '.*')).toBe(false);
  });
});

describe('Evaluación de matches en tiempo lineal', () => {
  it('Retroceso catastrófico en tiempo lineal', () => {
    const texto = 'a'.repeat(5000) + '!';
    expect(ev(texto, 'matches', '^(a+)+$')).toBe(false);
    expect(ev(texto, 'matches', '(a|aa)*!$')).toBe(true);
  });
});

describe('Construcciones admitidas en matches', () => {
  it('Construcciones admitidas', () => {
    expect(ev('28001', 'matches', '^(?<prov>\\d{2})\\d+?$')).toBe(true);
    expect(ev('Ana', 'matches', '^\\p{L}+$')).toBe(true);
    expect(ev('Ana', 'matches', '\\bAna\\b')).toBe(true);
  });
});

describe('Tamaño máximo del patrón de matches', () => {
  it('Patrón por encima del tamaño máximo', () => {
    expect(ev('a', 'matches', 'a{1000}')).toBe(false);
    expect(() => ev('a', 'matches', 'a{1001}')).toThrow(InvalidRuleError);
    expect(() => ev('a', 'matches', '(a{40}){40}')).toThrow(InvalidRuleError);
  });
});

describe('Reglas matches que no se pueden evaluar', () => {
  it('Regex inválida', () => {
    expect(() => ev('28001', 'matches', '(')).toThrow(InvalidRuleError);
  });

  it('Value no string en matches', () => {
    for (const bad of [5, true, null, ['a'], { a: 1 }]) {
      expect(() => ev('28001', 'matches', bad)).toThrow(InvalidRuleError);
    }
  });

  it('Construcción no admitida en matches', () => {
    for (const pattern of ['(a)\\1', 'a(?=a)', '(?<=a)a', '(?<x>a)|(?<x>b)']) {
      expect(() => ev('aa', 'matches', pattern), pattern).toThrow(InvalidRuleError);
    }
  });

  it('un patrón roto falla aunque la variable no tenga valor', () => {
    expect(() => ev(NONE, 'matches', '(')).toThrow(InvalidRuleError);
  });

  it('el mensaje no incluye el valor de la variable', () => {
    try {
      ev('ana@example.com', 'matches', '(');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('ana@example.com');
      expect((error as Error).message).toContain("'v'");
    }
  });
});

describe('Operadores isSet e isEmpty', () => {
  it('String vacío', () => {
    expect(ev('', 'isSet')).toBe(true);
    expect(ev('', 'isEmpty')).toBe(true);
  });

  it('Solo espacios', () => {
    expect(ev('   ', 'isEmpty')).toBe(true);
  });

  it('Cero, false y colecciones', () => {
    expect(ev(0, 'isEmpty')).toBe(false);
    expect(ev(false, 'isEmpty')).toBe(false);
    expect(ev([], 'isEmpty')).toBe(true);
    expect(ev({}, 'isEmpty')).toBe(true);
    expect(ev([0], 'isEmpty')).toBe(false);
    expect(ev({ a: 1 }, 'isEmpty')).toBe(false);
  });

  it('Se ignora value', () => {
    expect(ev('Ana', 'isSet', false)).toBe(true);
    expect(ev('Ana', 'isEmpty', true)).toBe(false);
  });

  it('Sin valor', () => {
    expect(ev(NONE, 'isSet')).toBe(false);
    expect(ev(NONE, 'isEmpty')).toBe(true);
  });
});

describe('Reglas que no se pueden evaluar', () => {
  it('Falta value', () => {
    for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'matches'] as const) {
      expect(() => ev('x', op)).toThrow(InvalidRuleError);
    }
  });

  it('el mensaje nombra la variable y el operador pero no su valor', () => {
    try {
      ev('ana@example.com', 'eq');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("'v'");
      expect((error as Error).message).toContain("'eq'");
      expect((error as Error).message).not.toContain('ana@example.com');
    }
  });

  it('value null no es "falta value"', () => {
    expect(ev(NONE, 'eq', null)).toBe(true);
  });
});

describe('Predicados all y any', () => {
  const lookup = (name: string): VariableValue | undefined =>
    ({ segmento: 'pyme', a: 1, b: 2 })[name as 'segmento' | 'a' | 'b'];
  const eq = (variable: string, value: unknown): Predicate => ({ variable, op: 'eq', value });

  it('all con un elemento falso', () => {
    expect(evaluatePredicate({ all: [eq('segmento', 'pyme'), eq('segmento', 'empresa')] }, lookup)).toBe(false);
  });

  it('any con un elemento verdadero', () => {
    expect(evaluatePredicate({ any: [eq('segmento', 'empresa'), eq('segmento', 'pyme')] }, lookup)).toBe(true);
  });

  it('El cortocircuito evita errores', () => {
    const sinValue: Predicate = { variable: 'segmento', op: 'eq' };
    expect(evaluatePredicate({ all: [eq('segmento', 'empresa'), sinValue] }, lookup)).toBe(false);
    expect(evaluatePredicate({ any: [eq('segmento', 'pyme'), sinValue] }, lookup)).toBe(true);
    expect(() => evaluatePredicate({ all: [eq('segmento', 'pyme'), sinValue] }, lookup)).toThrow(InvalidRuleError);
  });

  it('Predicados anidados', () => {
    const p: Predicate = {
      any: [{ all: [eq('a', 1), eq('b', 3)] }, { all: [eq('a', 1), eq('b', 2)] }],
    };
    expect(evaluatePredicate(p, lookup)).toBe(true);
  });
});

describe('OPERATORS', () => {
  it('tiene una entrada por operador', () => {
    expect(Object.keys(OPERATORS).sort()).toEqual(
      ['contains', 'eq', 'gt', 'gte', 'isEmpty', 'isSet', 'lt', 'lte', 'matches', 'neq', 'startsWith'].sort(),
    );
  });
});
