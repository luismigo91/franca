import type { TextParser } from './types.js';

const ALWAYS = new Map([
  ['true', true],
  ['false', false],
]);

const WORDS = new Map<string, ReadonlyMap<string, boolean>>([
  ['es', new Map([['sí', true], ['si', true], ['no', false]])],
  ['en', new Map([['yes', true], ['y', true], ['no', false], ['n', false]])],
]);

/**
 * `boolean`: `true`/`false` en cualquier idioma, más las palabras del idioma del flujo. Normaliza a
 * NFC y usa solo `toLowerCase`, que no depende del locale del host.
 */
export const parseBoolean: TextParser = (text, language) => {
  const word = text.normalize('NFC').toLowerCase();
  return ALWAYS.get(word) ?? WORDS.get(language)?.get(word);
};
