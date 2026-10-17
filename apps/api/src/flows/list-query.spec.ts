import { describe, expect, it } from 'vitest';
import { parseListQuery } from './list-query.js';

describe('parseListQuery', () => {
  it('sin parámetros: 20, 0 y sin filtro', () => {
    expect(parseListQuery({})).toEqual({ limit: 20, offset: 0 });
  });

  it.each([
    [{ limit: '1' }, { limit: 1, offset: 0 }],
    [{ limit: '100' }, { limit: 100, offset: 0 }],
    [{ offset: '0' }, { limit: 20, offset: 0 }],
    [{ offset: '2147483647' }, { limit: 20, offset: 2147483647 }],
    [{ published: 'true' }, { limit: 20, offset: 0, published: true }],
    [{ published: 'false', limit: '5', offset: '10' }, { limit: 5, offset: 10, published: false }],
    [{ orden: 'nombre', extra: ['a', 'b'] }, { limit: 20, offset: 0 }],
  ])('admite %j', (query, expected) => {
    expect(parseListQuery(query)).toEqual(expected);
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: 'abc' },
    { limit: '2.5' },
    { limit: '' },
    { limit: ' 2' },
    { limit: '+2' },
    { limit: '1e1' },
    { limit: '99999999999' },
    { offset: '-1' },
    { offset: '2147483648' },
    { offset: '' },
    { limit: ['1', '2'] },
    { offset: ['1', '2'] },
    { published: 'si' },
    { published: 'TRUE' },
    { published: '' },
    { published: ['true', 'true'] },
  ])('rechaza %j con invalid_query', (query) => {
    expect(() => parseListQuery(query)).toThrowError(expect.objectContaining({ code: 'invalid_query' }));
  });
});
