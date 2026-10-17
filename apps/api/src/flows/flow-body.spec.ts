import { describe, expect, it } from 'vitest';
import { inspectFlowBody } from './flow-body.js';

const hola = { specVersion: '0.1', id: 'hola', name: 'Hola', start: 'fin', nodes: [{ id: 'fin', type: 'end' }] };

describe('inspectFlowBody', () => {
  it('un flujo válido da el veredicto y el texto de su forma JSON', () => {
    const { verdict, text } = inspectFlowBody(hola);
    expect(verdict.valid).toBe(true);
    expect(text).toBe(JSON.stringify(hola));
  });

  it('valida lo que se guardaría: 1e400 llega como null', () => {
    const parsed = JSON.parse(
      '{"specVersion":"0.1","id":"hola","name":"Hola","start":"fin","variables":[{"name":"limite","type":"number","default":1e400}],"nodes":[{"id":"fin","type":"end"}]}',
    );
    expect(parsed.variables[0].default).toBe(Number.POSITIVE_INFINITY);
    const { verdict, text } = inspectFlowBody(parsed);
    expect(verdict.valid).toBe(true);
    expect(JSON.parse(text!).variables[0].default).toBeNull();
  });

  it('un número no representable donde se exige un número es un error de forma', () => {
    const parsed = JSON.parse(
      '{"specVersion":"0.1","id":"hola","name":"Hola","start":"fin","nodes":[{"id":"fin","type":"end","position":{"x":1e400,"y":0}}]}',
    );
    const { verdict } = inspectFlowBody(parsed);
    expect(verdict.issues).toEqual([{ layer: 'shape', path: '/nodes/0/position/x', nodeId: 'fin', message: 'debe ser de tipo number' }]);
  });

  it('un cuerpo demasiado profundo no lanza, no da texto y solo informa de la profundidad', () => {
    let deep: unknown = 1;
    for (let level = 0; level < 524_287; level++) deep = [deep];
    const { verdict, text } = inspectFlowBody(deep);
    expect(text).toBeUndefined();
    expect(verdict.valid).toBe(false);
    expect(verdict.issues).toEqual([
      { layer: 'shape', path: '', message: 'el flujo supera la profundidad máxima de anidamiento (1000)' },
    ]);
  });

  it('conserva __proto__ como clave normal y el orden de las propiedades', () => {
    const { text } = inspectFlowBody(JSON.parse('{"b":1,"__proto__":{"x":1},"2":2,"a":3}'));
    expect(text).toBe('{"2":2,"b":1,"__proto__":{"x":1},"a":3}');
  });
});
