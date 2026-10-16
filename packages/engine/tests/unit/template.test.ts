import { describe, expect, it } from 'vitest';
import { MAX_RENDERED_LENGTH } from '../../src/constants.js';
import { renderTemplate, textOf, ValueTooLargeError } from '../../src/template.js';
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
