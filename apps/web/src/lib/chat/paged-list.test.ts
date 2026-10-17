import { describe, expect, it } from 'vitest';
import type { Page } from '@/lib/chat/api-types';
import { appendPage, emptyPagedList, hasMore } from '@/lib/chat/paged-list';

const page = (ids: string[], offset: number, total: number): Page<{ id: string }> => ({ items: ids.map((id) => ({ id })), total, limit: 20, offset });

describe('paged-list', () => {
  it('añade una página sin repetir ningún id', () => {
    const first = appendPage(emptyPagedList<{ id: string }>(), page(['a', 'b'], 0, 3));
    const second = appendPage(first, page(['b', 'c'], 2, 3));
    expect(second.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(first.items).toHaveLength(2);
  });

  it('sabe si quedan más: offset + items < total', () => {
    const first = appendPage(emptyPagedList<{ id: string }>(), page(['a', 'b'], 0, 3));
    expect(first.nextOffset).toBe(2);
    expect(hasMore(first)).toBe(true);
    expect(hasMore(appendPage(first, page(['c'], 2, 3)))).toBe(false);
  });

  it('una página vacía con total mayor no promete más', () => {
    const list = appendPage(appendPage(emptyPagedList<{ id: string }>(), page(['a'], 0, 5)), page([], 1, 5));
    expect(hasMore(list)).toBe(false);
    expect(hasMore(emptyPagedList())).toBe(false);
  });

  it('con 21 flujos: 20 y después 21', () => {
    const ids = Array.from({ length: 21 }, (_, index) => `f${index}`);
    const first = appendPage(emptyPagedList<{ id: string }>(), page(ids.slice(0, 20), 0, 21));
    expect(first.items).toHaveLength(20);
    expect(hasMore(first)).toBe(true);
    const second = appendPage(first, page(ids.slice(20), 20, 21));
    expect(second.items).toHaveLength(21);
    expect(hasMore(second)).toBe(false);
  });
});
