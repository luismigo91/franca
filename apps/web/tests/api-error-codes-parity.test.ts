import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@/config/api-error-codes';
import { WEB_ERROR_CODES } from '@/config/web-error-codes';

const API_SOURCE = readFileSync(new URL('../../api/src/http/api-error.ts', import.meta.url), 'utf8');

/** Los literales entre `export const API_ERROR_CODES = [` y `] as const;` del texto de la API. */
function extractApiCodes(source: string): string[] {
  const start = source.indexOf('export const API_ERROR_CODES = [');
  const end = source.indexOf('] as const;', start);
  if (start === -1 || end === -1) return [];
  return [...source.slice(start, end).matchAll(/'([a-z][a-z0-9_]*)'/g)].map((match) => match[1]!);
}

describe('códigos de error', () => {
  it('Paridad de códigos', () => {
    const apiCodes = extractApiCodes(API_SOURCE);
    // Si la API reescribe la declaración, el extractor no encuentra nada y esto falla en voz alta (R9).
    expect(apiCodes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(apiCodes).size).toBe(apiCodes.length);
    expect(new Set(API_ERROR_CODES)).toEqual(new Set(apiCodes));
    expect([...API_ERROR_CODES]).toEqual(apiCodes);
  });

  it('el extractor falla en voz alta si cambia la declaración de la API', () => {
    expect(extractApiCodes('export const OTROS = [\'a\'] as const;')).toEqual([]);
  });

  it('los códigos de la web y los de la API son disjuntos', () => {
    for (const code of WEB_ERROR_CODES) expect(API_ERROR_CODES as readonly string[]).not.toContain(code);
  });
});
