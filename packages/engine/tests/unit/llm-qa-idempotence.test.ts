import { describe, expect, it } from 'vitest';
import { convertSlotValue } from '../../src/llm/slots.js';
import type { VariableType } from '../../src/index.js';

/**
 * Fuzz de la hipótesis de la que depende la reanudación: lo que un conversor acepta, vuelve a
 * aceptarse igual (y tras pasar por JSON, como el estado). Si no, un slot recogido desaparecería en
 * silencio en el turno siguiente. Corpus generado con una semilla fija a partir de fragmentos con
 * mala fama de cada tipo; los escapes `\uXXXX` evitan caracteres invisibles en el fichero.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAGMENTS: Record<Exclude<VariableType, 'json'>, readonly string[]> = {
  string: ['a', ' ', 'ñ', 'é', 'é', ' ', ' ', '﻿', '​', '‮', '😀', '{{x}}', '1.500', 'null', '\t', '\r\n', '\u0085', '\u007f', '￾', '￿'],
  email: ['ana', 'A', '+tag', '.', '..', '_', "'", '-', '@', 'example', 'EXAMPLE', '.com', '.co.uk', '.c', 'xn--bcher-kva', 'bücher', 'ñ', '"', ' ', '[1.2.3.4]', 'localhost', '​', 'é', ' '],
  phone: ['+', '34', '600', '12', '34', '56', ' ', '-', '.', '(', ')', '0', '00', ' ', '٣', '１', 'x', '123456789012345', '1234567890123456'],
  number: ['0', '1', '9', '.', ',', '-', '+', '00', '0.', '.5', 'e5', 'E-3', '1e21', '123456789012345', '1234567890123456', '0.1', ' ', '١', '−', 'Infinity', 'NaN', '0x1f', '_'],
  url: ['http://', 'https://', 'HTTP://', 'example', '.com', 'EXAMPLE', ':80', ':443', ':0', ':65536', '/', '/a', '?q=1', '#f', '%20', '%2F', '%zz', ' ', '@', 'user:pw@', '.', '..', 'xn--bcher-kva', 'bücher', 'ñ', '127.0.0.1', '[::1]', 'localhost', '\\', '。', '．', '​', 'ftp://', '//'],
  date: ['2026', '2024', '0001', '9999', '0000', '10000', '-', '/', '02', '29', '30', '31', '13', '00', '01', 'T', ':', ' ', '١', '２'],
  boolean: ['sí', 'si', 'SÍ', 'no', 'No', 'true', 'TRUE', 'false', 'yes', 'y', 'n', '1', '0', ' ', '.', '!', 'quizá'],
};

const TYPES = Object.keys(FRAGMENTS) as Exclude<VariableType, 'json'>[];

function concat(random: () => number, parts: readonly string[], max: number): string {
  const count = 1 + Math.floor(random() * max);
  let text = '';
  for (let i = 0; i < count; i++) text += parts[Math.floor(random() * parts.length)]!;
  return text;
}

/** Email y fecha tienen una forma fija: se fuerza la estructura y se ensucian sus partes. */
function generate(random: () => number, type: Exclude<VariableType, 'json'>): string {
  const parts = FRAGMENTS[type];
  if (type === 'email') return `${concat(random, parts, 3)}@${concat(random, parts, 3)}.${concat(random, ['com', 'COM', 'co', 'uk', 'c', 'x1', 'xn--p1ai', '\u00f1'], 1)}`;
  if (type === 'date') return `${concat(random, ['2026', '2024', '0001', '9999', '0000', '1900', '2100', '12', '\u0661'], 1)}-${concat(random, ['02', '12', '00', '13', '1', '09'], 1)}-${concat(random, ['29', '30', '31', '00', '01', '1', '28'], 1)}${concat(random, ['', ' ', 'T', ' 10:00'], 1)}`;
  return concat(random, parts, 7);
}

describe.each(TYPES)('Idempotencia del conversor de slots: %s', (type) => {
  it('lo aceptado se acepta igual otra vez, también tras pasar por JSON (30 000 cadenas al azar)', () => {
    const random = rng(7 + TYPES.indexOf(type));
    let accepted = 0;
    for (let i = 0; i < 30000; i++) {
      const input = generate(random, type);
      const once = convertSlotValue(type, input, 'es');
      if (once === undefined) continue;
      accepted++;
      const again = convertSlotValue(type, once, 'es');
      expect(again, `${type} ${JSON.stringify(input)} -> ${JSON.stringify(once)}`).toEqual(once);
      const wire = JSON.parse(JSON.stringify(once)) as unknown;
      expect(convertSlotValue(type, wire, 'es'), `${type} ${JSON.stringify(input)} por JSON`).toEqual(once);
      if (typeof once === 'number') expect(Object.is(once, -0), `${type} ${JSON.stringify(input)}`).toBe(false);
      if (typeof once === 'string') {
        expect(once.length, `${type} ${JSON.stringify(input)}`).toBeLessThanOrEqual(4096);
        expect(once, 'sin U+0000').not.toContain('\u0000');
      }
    }
    // El corpus tiene que ejercitar el camino de aceptación.
    expect(accepted, `${type}: cadenas aceptadas`).toBeGreaterThan(200);
  });
});
