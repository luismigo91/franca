import { describe, expect, it } from 'vitest';
import { MAX_RENDERED_LENGTH } from '../../src/constants.js';
import { measureTemplate, renderTemplate, templateVariables, textOf, ValueTooLargeError } from '../../src/template.js';
import type { VariableValue } from '../../src/types.js';

const vars = (values: Record<string, VariableValue>) => (name: string) =>
  Object.hasOwn(values, name) ? values[name] : undefined;

describe('Sustitución de plantillas', () => {
  it('Marcador con espacios', () => {
    expect(renderTemplate('Hola {{ nombre }}, ¿qué tal {{nombre}}?', vars({ nombre: 'Ana' }))).toBe(
      'Hola Ana, ¿qué tal Ana?',
    );
  });

  it('Variable sin valor', () => {
    expect(renderTemplate('Gracias, {{nombre}}.', vars({}))).toBe('Gracias, .');
  });

  it('Patrones que no son marcadores', () => {
    for (const text of ['{{a.b}}', '{nombre}', '{{ 1x }}']) {
      expect(renderTemplate(text, vars({ a: 'X', nombre: 'Y', '1x': 'Z' }))).toBe(text);
    }
  });
});

describe('Forma textual de los valores', () => {
  it('Números sin formato local', () => {
    expect(renderTemplate('{{importe}}', vars({ importe: 1500.5 }))).toBe('1500.5');
  });

  it('Booleanos', () => {
    expect(renderTemplate('{{resuelto}}', vars({ resuelto: true }))).toBe('true');
    expect(textOf(false)).toBe('false');
  });

  it('Objetos y arrays', () => {
    expect(renderTemplate('{{datos}}', vars({ datos: { a: 'x', b: [1, 2] } }))).toBe('{"a":"x","b":[1,2]}');
  });

  it('un valor sin valor es cadena vacía', () => {
    expect(textOf(undefined)).toBe('');
  });
});

describe('Plantillas en una pasada y como texto plano', () => {
  it('Un valor con marcadores no se expande', () => {
    expect(
      renderTemplate('Dijiste: {{comentario}}', vars({ comentario: '{{email}}', email: 'ana@example.com' })),
    ).toBe('Dijiste: {{email}}');
  });

  it('El HTML pasa sin tocar', () => {
    expect(renderTemplate('Hola {{nombre}}', vars({ nombre: '<b>Ana</b>' }))).toBe('Hola <b>Ana</b>');
  });
});

describe('Tamaño máximo del renderizado', () => {
  it('admite exactamente 16384 unidades de código', () => {
    expect(renderTemplate('{{a}}', vars({ a: 'x'.repeat(MAX_RENDERED_LENGTH) }))).toHaveLength(MAX_RENDERED_LENGTH);
  });

  it('rechaza 16385', () => {
    expect(() => renderTemplate('{{a}}!', vars({ a: 'x'.repeat(MAX_RENDERED_LENGTH) }))).toThrow(ValueTooLargeError);
  });

  it('cuenta unidades de código, no code points', () => {
    expect(() => renderTemplate('{{a}}', vars({ a: '😀'.repeat(MAX_RENDERED_LENGTH / 2 + 1) }))).toThrow(
      ValueTooLargeError,
    );
  });

  it('un literal por encima del límite también se rechaza', () => {
    expect(() => renderTemplate('y'.repeat(MAX_RENDERED_LENGTH + 1), vars({}))).toThrow(ValueTooLargeError);
  });

  it('corta un marcador repetido sin construir la cadena completa', () => {
    const big = 'x'.repeat(MAX_RENDERED_LENGTH / 2 + 1);
    let lookups = 0;
    const lookup = (): VariableValue => {
      lookups++;
      return big;
    };
    // 1 millón de marcadores: si no cortara, construiría ~8 GB.
    expect(() => renderTemplate('{{a}}'.repeat(1_000_000), lookup)).toThrow(ValueTooLargeError);
    expect(lookups).toBe(2);
  });
});

describe('renderTemplate: opciones', () => {
  it('maxLength propio sustituye al general', () => {
    expect(renderTemplate('{{a}}', vars({ a: 'x'.repeat(10) }), { maxLength: 10 })).toHaveLength(10);
    expect(() => renderTemplate('{{a}}', vars({ a: 'x'.repeat(11) }), { maxLength: 10 })).toThrow(ValueTooLargeError);
    // un límite mayor que el general también se respeta
    expect(renderTemplate('{{a}}', vars({ a: 'x'.repeat(MAX_RENDERED_LENGTH + 1) }), { maxLength: MAX_RENDERED_LENGTH + 5 })).toHaveLength(
      MAX_RENDERED_LENGTH + 1,
    );
  });

  it('insert transforma solo los valores insertados, no el texto literal', () => {
    const upper = (text: string) => text.toUpperCase();
    expect(renderTemplate('ab {{a}} cd', vars({ a: 'xy' }), { insert: upper })).toBe('ab XY cd');
  });

  it('insert recibe lo que queda de presupuesto', () => {
    const budgets: number[] = [];
    renderTemplate('abc{{a}}de{{a}}', vars({ a: 'xy' }), {
      maxLength: 20,
      insert: (text, budget) => (budgets.push(budget), text),
    });
    expect(budgets).toEqual([17, 13]);
  });

  it('el texto transformado cuenta para el límite', () => {
    expect(() => renderTemplate('{{a}}', vars({ a: 'x' }), { maxLength: 4, insert: (text) => text.repeat(5) })).toThrow(ValueTooLargeError);
  });

  it('si insert lanza, el error se propaga', () => {
    class Boom extends Error {}
    expect(() => renderTemplate('{{a}}', vars({ a: 'x' }), { insert: () => { throw new Boom(); } })).toThrow(Boom);
  });

  it('sin opciones se comporta como antes', () => {
    expect(renderTemplate('{{a}}-{{b}}', vars({ a: 1, b: true }))).toBe('1-true');
    expect(renderTemplate('{{a}}-{{b}}', vars({ a: 1, b: true }), {})).toBe('1-true');
  });
});

describe('measureTemplate', () => {
  const cases: [string, Record<string, VariableValue>][] = [
    ['', {}],
    ['literal', {}],
    ['Hola {{ nombre }}, ¿qué tal {{nombre}}?', { nombre: 'Ana' }],
    ['Gracias, {{nombre}}.', {}],
    ['{{importe}}', { importe: 1500.5 }],
    ['{{datos}}', { datos: { a: 'x', b: [1, 2] } }],
    ['{{a}}{{a}}{{a}}', { a: 'xyz' }],
    ['{{a.b}} {nombre} {{ 1x }}', { a: 'no' }],
    ['{{a}}', { a: 'x'.repeat(MAX_RENDERED_LENGTH) }],
  ];

  it.each(cases)('%j mide lo mismo que renderTemplate(...).length', (template, values) => {
    expect(measureTemplate(template, vars(values))).toBe(renderTemplate(template, vars(values)).length);
  });

  it('lanza en el mismo punto que renderTemplate', () => {
    const lookups: string[] = [];
    const measuring = (name: string): VariableValue | undefined => (lookups.push(`m:${name}`), 'x'.repeat(MAX_RENDERED_LENGTH));
    const rendering = (name: string): VariableValue | undefined => (lookups.push(`r:${name}`), 'x'.repeat(MAX_RENDERED_LENGTH));
    expect(() => measureTemplate('{{a}}{{b}}{{c}}', measuring)).toThrow(ValueTooLargeError);
    expect(() => renderTemplate('{{a}}{{b}}{{c}}', rendering)).toThrow(ValueTooLargeError);
    expect(lookups.map((l) => l.slice(2))).toEqual(['a', 'b', 'a', 'b']);
  });

  it('16384 se admite y 16385 se rechaza', () => {
    expect(measureTemplate('{{a}}', vars({ a: 'x'.repeat(MAX_RENDERED_LENGTH) }))).toBe(MAX_RENDERED_LENGTH);
    expect(() => measureTemplate('{{a}}!', vars({ a: 'x'.repeat(MAX_RENDERED_LENGTH) }))).toThrow(ValueTooLargeError);
  });

  it('un literal por encima del límite se rechaza', () => {
    expect(() => measureTemplate('y'.repeat(MAX_RENDERED_LENGTH + 1), vars({}))).toThrow(ValueTooLargeError);
  });

  it('no construye el texto: un marcador repetido un millón de veces corta en el segundo', () => {
    let lookups = 0;
    expect(() =>
      measureTemplate('{{a}}'.repeat(1_000_000), () => (lookups++, 'x'.repeat(MAX_RENDERED_LENGTH / 2 + 1))),
    ).toThrow(ValueTooLargeError);
    expect(lookups).toBe(2);
  });
});

describe('templateVariables', () => {
  it('devuelve los nombres en orden, con repeticiones y con espacios dentro de las llaves', () => {
    expect(templateVariables('{{a}} x {{ b }} {{a}}')).toEqual(['a', 'b', 'a']);
  });

  it('ignora lo que no es un marcador', () => {
    expect(templateVariables('{{a.b}} {nombre} {{ 1x }} {{}}')).toEqual([]);
    expect(templateVariables('')).toEqual([]);
  });

  it('usa la misma gramática que renderTemplate', () => {
    const template = '{{ _a1 }}{{b}} {{ c}}{{d }}';
    const seen: string[] = [];
    renderTemplate(template, (name) => (seen.push(name), 'x'));
    expect(templateVariables(template)).toEqual(seen);
  });
});
