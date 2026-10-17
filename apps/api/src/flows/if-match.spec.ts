import { describe, expect, it } from 'vitest';
import { etagOf, matchesIfMatch } from './if-match.js';

describe('matchesIfMatch', () => {
  it.each([
    ['"1"', 1],
    ['*', 7],
    [' * ', 7],
    ['"1", "2"', 2],
    ['"2","1"', 1],
    ['"0", "3" ,"4"', 3],
  ])('%s acepta la revisión %i', (header, revision) => {
    expect(matchesIfMatch(header, revision)).toBe(true);
  });

  it.each([
    ['"1"', 2],
    ['W/"1"', 1],
    ['w/"1"', 1],
    ['1', 1],
    ['', 1],
    ['"01"', 1],
    ['"1.0"', 1],
    ['"+1"', 1],
    ['" 1"', 1],
    ['"1', 1],
    ['* , "2"', 1],
    ['**', 1],
    ['"1" "2"', 2],
  ])('%j no acepta la revisión %i', (header, revision) => {
    expect(matchesIfMatch(header, revision)).toBe(false);
  });
});

describe('etagOf', () => {
  it('es la revisión entre comillas', () => {
    expect(etagOf(3)).toBe('"3"');
  });
});
