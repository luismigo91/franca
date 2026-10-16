import { describe, expect, it } from 'vitest';
import { checkTextAnswer } from '../../src/input/answer.js';
import { readAssistantText } from '../../src/llm/text.js';

describe('readAssistantText', () => {
  it('recorta el texto', () => {
    expect(readAssistantText('  ¿Me das tu email?\n')).toBe('¿Me das tu email?');
  });

  it.each(['', '   ', '\n\t ', ' ', ' '])('el texto %j, recortado, queda vacío → null', (raw) => {
    expect(readAssistantText(raw)).toBeNull();
  });

  it('4096 caracteres valen y 4097 no', () => {
    expect(readAssistantText('a'.repeat(4096))).toBe('a'.repeat(4096));
    expect(readAssistantText('a'.repeat(4097))).toBeNull();
  });

  it('se mide después de recortar: 4096 «a» rodeados de espacios valen, 4097 «a» rodeados no', () => {
    expect(readAssistantText(`  ${'a'.repeat(4096)}\n `)).toBe('a'.repeat(4096));
    expect(readAssistantText(` ${'a'.repeat(4097)} `)).toBeNull();
  });

  it('a diferencia del usuario: 4097 espacios son vacío para el asistente y too_long para el usuario', () => {
    expect(readAssistantText(' '.repeat(4097))).toBeNull();
    expect(checkTextAnswer(' '.repeat(4097), 'text', 'es', { program: null })).toEqual({ ok: false, reason: 'too_long' });
    expect(checkTextAnswer(' '.repeat(4096), 'text', 'es', { program: null })).toEqual({ ok: false, reason: 'required' });
  });

  it.each(['Hola\u0000', '\u0000', 'Ho\u0000la', 'Hola\ud800', '\udc00Hola', 'a\ud800b'])('%j contiene U+0000 o un sustituto suelto → null', (raw) => {
    expect(readAssistantText(raw)).toBeNull();
  });

  it('un par de sustitutos válido (emoji) se acepta', () => {
    expect(readAssistantText('Hola 😀')).toBe('Hola 😀');
  });

  it('es literal: una plantilla no se renderiza ni se toca', () => {
    expect(readAssistantText('Tu email es {{email}}')).toBe('Tu email es {{email}}');
  });

  it('solo conserva los saltos de línea del interior', () => {
    expect(readAssistantText('\nlínea 1\nlínea 2\n')).toBe('línea 1\nlínea 2');
  });
});
